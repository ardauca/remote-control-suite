// Automated Rate Limiting Verification Test Script

const WS_URL = 'ws://localhost:52520/ws';

async function runRateLimitTests() {
  console.log('====================================================');
  console.log('   Remote Control Suite - Rate Limiting Verification');
  console.log('====================================================\n');

  function connectSocket() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Connection timeout'));
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = (err) => {
        clearTimeout(timer);
        reject(err);
      };
    });
  }

  const ws = await connectSocket();
  const messages = [];

  ws.onmessage = (event) => {
    messages.push(JSON.parse(event.data));
  };

  // Wait for initial hello
  await new Promise((r) => setTimeout(r, 200));

  console.log('[Test] Firing a burst of 10 power commands (Bucket capacity is 2) ...');
  for (let i = 0; i < 10; i++) {
    ws.send(JSON.stringify({
      version: 1,
      id: crypto.randomUUID(),
      type: 'command',
      action: 'power.action',
      payload: { action: 'lock' },
      timestamp: Date.now()
    }));
  }

  // Allow responses to arrive
  await new Promise((r) => setTimeout(r, 600));

  const rateLimitedMessages = messages.filter(
    (m) => m.action === 'system.error' && m.payload?.code === 'RATE_LIMITED'
  );

  console.log(`Received ${messages.length} responses total.`);
  console.log(`Received ${rateLimitedMessages.length} RATE_LIMITED responses.`);

  ws.close();

  if (rateLimitedMessages.length > 0) {
    console.log('\n✔ PASS: Rate limiting successfully intercepted burst abuse!');
    console.log(`  Sample message: "${rateLimitedMessages[0].payload.message}"`);
  } else {
    console.error('\n✖ FAIL: Rate limiter did not trigger on rapid burst!');
    process.exit(1);
  }
}

runRateLimitTests().catch((err) => {
  console.error('Fatal rate limit test error:', err);
  process.exit(1);
});

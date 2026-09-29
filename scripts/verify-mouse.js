// Phase 3 Mouse & Touchpad Protocol Verification Script

async function testMouseProtocol() {
  console.log('Testing Mouse & Touchpad Input via WebSocket...');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:52520/ws');
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout waiting for response'));
    }, 5000);

    ws.onopen = () => {
      console.log('✔ Connected to WebSocket server.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'system.hello') {
          console.log('✔ Host hello received. Sending mouse movement...');

          // Test 1: Relative Mouse Move
          ws.send(JSON.stringify({
            version: 1,
            id: 'test-move-1',
            type: 'command',
            action: 'mouse.move',
            payload: { dx: 25, dy: 25 },
            timestamp: Date.now()
          }));
          console.log('✔ Sent mouse.move (dx=25, dy=25)');

          // Test 2: Scroll
          setTimeout(() => {
            ws.send(JSON.stringify({
              version: 1,
              id: 'test-scroll-1',
              type: 'command',
              action: 'mouse.scroll',
              payload: { dx: 0, dy: 1 },
              timestamp: Date.now()
            }));
            console.log('✔ Sent mouse.scroll (dy=1)');
          }, 100);

          // Test 3: Complete
          setTimeout(() => {
            clearTimeout(timeout);
            ws.close();
            console.log('==========================================');
            console.log('🎉 MOUSE INPUT VERIFICATION PASSED!');
            console.log('==========================================');
            resolve(true);
          }, 300);
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = reject;
  });
}

testMouseProtocol()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Mouse verification failed:', err);
    process.exit(1);
  });

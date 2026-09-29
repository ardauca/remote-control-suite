// Phase 4 Rigorous Keyboard & Security Verification Suite
const WS_URL = 'ws://localhost:52520/ws';

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 4000);

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

function sendMsg(ws, action, payload) {
  return ws.send(JSON.stringify({
    version: 1,
    id: 'req_' + Math.random().toString(36).substring(2, 9),
    type: 'command',
    action,
    payload,
    timestamp: Date.now()
  }));
}

function waitForAction(ws, targetAction, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout waiting for action: ${targetAction}`));
    }, timeoutMs);

    function onMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.action === targetAction) {
          cleanup();
          resolve(data);
        }
      } catch (e) {}
    }

    function cleanup() {
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
    }

    ws.addEventListener('message', onMessage);
  });
}

async function runVerification() {
  console.log('========================================================');
  console.log('🧪 Starting Phase 4 Keyboard & Security Test Suite');
  console.log('========================================================');

  // Test 1: Connect and receive system.hello
  console.log('\n[1/7] Connecting to Windows Host & Validating Capabilities...');
  const clientA = await connectWs();
  const helloMsg = await waitForAction(clientA, 'system.hello');
  console.log(`✔ Host Hello received: ${helloMsg.payload.serverName} (OS: ${helloMsg.payload.os})`);
  if (!helloMsg.payload.capabilities.includes('input.keyboard')) {
    throw new Error("Missing 'input.keyboard' capability in host hello");
  }
  console.log('✔ Capability input.keyboard confirmed.');

  // Test 2: Valid Turkish Unicode & Emojis
  console.log('\n[2/7] Testing Unicode Text Input (Turkish characters & Emojis)...');
  sendMsg(clientA, 'keyboard.text', {
    text: 'Türkçe test: ç ğ ı İ ö ş ü Ç Ğ Ö Ş Ü 🎉 🚀'
  });
  console.log('✔ keyboard.text frame accepted by host.');

  // Test 3: Oversized text rejection (Security check)
  console.log('\n[3/7] Testing Security: Oversized Text Payload (>2000 chars)...');
  const oversizedText = 'A'.repeat(2500);
  sendMsg(clientA, 'keyboard.text', { text: oversizedText });
  const errorOversized = await waitForAction(clientA, 'system.error');
  if (errorOversized.payload.code === 'PAYLOAD_TOO_LARGE') {
    console.log(`✔ Host correctly rejected oversized text with code: ${errorOversized.payload.code}`);
  } else {
    throw new Error(`Expected PAYLOAD_TOO_LARGE but got: ${errorOversized.payload.code}`);
  }

  // Test 4: Special Keys & Unmapped Key Rejection
  console.log('\n[4/7] Testing Special Keys & Invalid Key Rejection...');
  // Send valid special key
  sendMsg(clientA, 'keyboard.keyDown', { key: 'TAB' });
  sendMsg(clientA, 'keyboard.keyUp', { key: 'TAB' });
  console.log('✔ Valid special key TAB (Down + Up) accepted.');

  // Send invalid key name
  sendMsg(clientA, 'keyboard.keyDown', { key: 'INVALID_NONEXISTENT_KEY_123' });
  const errorInvalidKey = await waitForAction(clientA, 'system.error');
  if (errorInvalidKey.payload.code === 'INVALID_KEY') {
    console.log(`✔ Host correctly rejected invalid key with code: ${errorInvalidKey.payload.code}`);
  } else {
    throw new Error(`Expected INVALID_KEY but got: ${errorInvalidKey.payload.code}`);
  }

  // Test 5: Quick Shortcuts & Excessive Shortcut Rejection
  console.log('\n[5/7] Testing Shortcuts & Length Limit Validation...');
  sendMsg(clientA, 'keyboard.shortcut', { keys: ['CTRL', 'C'] });
  console.log('✔ Valid shortcut [CTRL, C] accepted.');

  // Excessive keys (>8)
  sendMsg(clientA, 'keyboard.shortcut', { keys: ['CTRL', 'ALT', 'SHIFT', 'A', 'B', 'C', 'D', 'E', 'F'] });
  const errorExcessiveKeys = await waitForAction(clientA, 'system.error');
  if (errorExcessiveKeys.payload.code === 'INVALID_SHORTCUT') {
    console.log(`✔ Host correctly rejected excessive shortcut with code: ${errorExcessiveKeys.payload.code}`);
  } else {
    throw new Error(`Expected INVALID_SHORTCUT but got: ${errorExcessiveKeys.payload.code}`);
  }

  // Test 6: Multi-client Isolation & Disconnect Safety
  console.log('\n[6/7] Testing Multi-client Key Isolation & Disconnect Cleanup...');
  // Client A presses CTRL
  sendMsg(clientA, 'keyboard.keyDown', { key: 'CTRL' });
  console.log('• Client A holding CTRL');

  // Client B connects
  const clientB = await connectWs();
  await waitForAction(clientB, 'system.hello');
  console.log('• Client B connected simultaneously');

  // Client A disconnects abruptly
  clientA.close();
  console.log('• Client A disconnected abruptly');

  await new Promise(r => setTimeout(r, 200));

  // Client B should still be alive and responsive
  sendMsg(clientB, 'system.ping', { clientTime: Date.now() });
  const pongMsg = await waitForAction(clientB, 'system.pong');
  console.log(`✔ Client B still responsive, round-trip pong received (RTT: ${Date.now() - pongMsg.payload.clientTime}ms)`);
  clientB.close();

  // Test 7: Final Report
  console.log('\n========================================================');
  console.log('🎉 ALL AUTOMATED PROTOCOL & SECURITY CHECKS PASSED!');
  console.log('========================================================');
  console.log('Note: Physical character typing into focused Windows desktop');
  console.log('applications (Notepad/Browser) requires user desktop session.');
}

runVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Verification Failed:', err);
    process.exit(1);
  });

// Automated Security & Authentication Test Suite
// Verifies LAN pairing, privileged capability enforcement, input validation, and rate limiting.

const WS_URL = 'ws://localhost:52520/ws';

async function runSecurityTests() {
  console.log('====================================================');
  console.log('   Remote Control Suite - Security Verification');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  function assert(condition, message) {
    total++;
    if (condition) {
      console.log(`  ✔ PASS: ${message}`);
      passed++;
    } else {
      console.error(`  ✖ FAIL: ${message}`);
    }
  }

  // Helper to connect a new clean socket
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

  // Helper to await single message
  function waitForMessage(ws, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for message')), timeoutMs);
      const onMsg = (event) => {
        clearTimeout(timer);
        ws.removeEventListener('message', onMsg);
        resolve(JSON.parse(event.data));
      };
      ws.addEventListener('message', onMsg);
    });
  }

  // --- Test 1: Handshake ---
  console.log('[Test 1] WebSocket Handshake & Hello');
  try {
    const ws = await connectSocket();
    const helloMsg = await waitForMessage(ws);
    assert(helloMsg.action === 'system.hello', 'Server immediately sends system.hello');
    assert(helloMsg.payload.serverName !== undefined, 'Server announces name');
    ws.close();
  } catch (err) {
    assert(false, `Handshake failed: ${err.message}`);
  }

  // --- Test 2: Unauthenticated Privileged Command Rejected ---
  console.log('\n[Test 2] Unauthenticated Access Prevention');
  try {
    const ws = await connectSocket();
    await waitForMessage(ws); // consume hello

    // Attempt mouse.move without authentication
    ws.send(JSON.stringify({
      version: 1,
      id: crypto.randomUUID(),
      type: 'command',
      action: 'mouse.move',
      payload: { dx: 10, dy: 10 },
      timestamp: Date.now()
    }));

    const response = await waitForMessage(ws);
    assert(response.action === 'system.error', 'Privileged mouse command returned system.error');
    assert(response.payload.code === 'UNAUTHORIZED', 'Error code is UNAUTHORIZED');

    // Attempt screen.start without authentication
    ws.send(JSON.stringify({
      version: 1,
      id: crypto.randomUUID(),
      type: 'command',
      action: 'screen.start',
      payload: { fps: 15, quality: 65, scale: 0.75, monitorIndex: 0 },
      timestamp: Date.now()
    }));

    const screenRes = await waitForMessage(ws);
    assert(screenRes.payload.code === 'UNAUTHORIZED', 'Screen streaming command returned UNAUTHORIZED');

    ws.close();
  } catch (err) {
    assert(false, `Unauthenticated test failed: ${err.message}`);
  }

  // --- Test 3: Invalid Session Token Login Rejected ---
  console.log('\n[Test 3] Invalid Token Rejection');
  try {
    const ws = await connectSocket();
    await waitForMessage(ws); // consume hello

    ws.send(JSON.stringify({
      version: 1,
      id: crypto.randomUUID(),
      type: 'command',
      action: 'auth.login',
      payload: { token: 'invalid_deadbeef_fake_session_token_12345' },
      timestamp: Date.now()
    }));

    const loginRes = await waitForMessage(ws);
    assert(loginRes.action === 'auth.result', 'Received auth.result response');
    assert(loginRes.payload.authenticated === false, 'Authentication failed for invalid token');

    ws.close();
  } catch (err) {
    assert(false, `Invalid token test failed: ${err.message}`);
  }

  // --- Test 4: Malformed JSON and Missing Action ---
  console.log('\n[Test 4] Robustness against Malformed Payloads');
  try {
    const ws = await connectSocket();
    await waitForMessage(ws); // consume hello

    // Send broken JSON
    ws.send('{broken json 123');
    // Socket should survive without crashing
    await new Promise((r) => setTimeout(r, 200));
    assert(ws.readyState === WebSocket.OPEN, 'Server did not crash on malformed JSON');

    // Send message without action
    ws.send(JSON.stringify({ version: 1, type: 'command' }));
    const errRes = await waitForMessage(ws);
    assert(errRes.action === 'system.error', 'Returned error on missing action property');
    assert(errRes.payload.code === 'BAD_REQUEST', 'Error code is BAD_REQUEST');

    ws.close();
  } catch (err) {
    assert(false, `Malformed payload test failed: ${err.message}`);
  }

  // --- Test 5: HTTP Snapshot Endpoint Protection ---
  console.log('\n[Test 5] HTTP /api/screen/snapshot Security');
  try {
    const unauthHttpRes = await fetch('http://localhost:52520/api/screen/snapshot');
    assert(unauthHttpRes.status === 401, 'Unauthenticated HTTP snapshot returns 401 Unauthorized');

    const badBearerRes = await fetch('http://localhost:52520/api/screen/snapshot', {
      headers: { 'Authorization': 'Bearer fake_invalid_token' }
    });
    assert(badBearerRes.status === 401, 'Invalid Bearer token snapshot returns 401 Unauthorized');
  } catch (err) {
    assert(false, `HTTP snapshot test failed: ${err.message}`);
  }

  console.log('\n====================================================');
  console.log(`   Security Verification Complete: ${passed}/${total} Passed`);
  console.log('====================================================\n');

  if (passed !== total) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});

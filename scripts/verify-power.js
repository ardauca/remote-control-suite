// Phase 6 Automated Power & System Controls Verification Script
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

function sendMsg(ws, action, payload = {}) {
  return ws.send(JSON.stringify({
    version: 1,
    id: 'req_' + Math.random().toString(36).substring(2, 9),
    type: 'command',
    action,
    payload,
    timestamp: Date.now()
  }));
}

function waitForAction(ws, targetAction, timeoutMs = 4000) {
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

async function runTest() {
  console.log('========================================================');
  console.log('🧪 Starting Phase 6 Power & System Controls Test Suite');
  console.log('========================================================');

  const ws = await connectWs();
  console.log('✔ Connected to WebSocket host.');

  // 1. Host Hello & Capabilities
  const hello = await waitForAction(ws, 'system.hello');
  console.log(`✔ Host Hello received: ${hello.payload.serverName} (OS: ${hello.payload.os})`);
  const caps = hello.payload.capabilities;
  if (!caps.includes('power.control')) {
    throw new Error('Host missing power.control capability');
  }
  console.log('✔ Capability power.control verified.');

  // 2. Initial Power Status
  console.log('\n[1/4] Testing Power Status Request...');
  sendMsg(ws, 'power.requestStatus');
  const initialStatus = await waitForAction(ws, 'power.status');
  console.log(`✔ Received Initial Power Status: Active=${initialStatus.payload.isActive}, Action=${initialStatus.payload.action}`);

  // 3. Schedule Timed Shutdown (30 Minutes = 1800s)
  console.log('\n[2/4] Testing 30-Minute Timed Shutdown (power.schedule)...');
  const targetSeconds = 1800; // 30 minutes
  sendMsg(ws, 'power.schedule', { action: 'shutdown', timeoutSeconds: targetSeconds });
  const scheduledStatus = await waitForAction(ws, 'power.status');
  console.log(`✔ Received Scheduled Status: Active=${scheduledStatus.payload.isActive}, Action=${scheduledStatus.payload.action}, Remaining=${scheduledStatus.payload.remainingSeconds}s`);
  if (!scheduledStatus.payload.isActive || scheduledStatus.payload.remainingSeconds <= 0) {
    throw new Error('Scheduled shutdown is not marked active or remaining seconds is invalid');
  }

  // 4. Test Live Countdown Tick
  console.log('\n[3/4] Testing Live Real-time Countdown Broadcast...');
  const nextTick = await waitForAction(ws, 'power.status', 3000);
  console.log(`✔ Received Countdown Tick: Remaining=${nextTick.payload.remainingSeconds}s`);

  // 5. Test Cancel Scheduled Shutdown (shutdown /a)
  console.log('\n[4/4] Testing Shutdown Cancellation (power.cancel)...');
  sendMsg(ws, 'power.cancel');
  const cancelledStatus = await waitForAction(ws, 'power.status');
  console.log(`✔ Received Cancelled Status: Active=${cancelledStatus.payload.isActive}, Action=${cancelledStatus.payload.action}`);
  if (cancelledStatus.payload.isActive) {
    throw new Error('Shutdown was not cancelled properly');
  }

  // 6. Test Non-Destructive System Shortcut Actions
  console.log('\n[Optional] Testing Non-destructive System Shortcut Actions...');
  sendMsg(ws, 'power.action', { action: 'showDesktop' });
  console.log('✔ Sent power.action (showDesktop - Win+D)');
  await new Promise(r => setTimeout(r, 200));

  sendMsg(ws, 'power.action', { action: 'showDesktop' }); // Toggle back
  console.log('✔ Sent power.action (showDesktop toggle back)');
  await new Promise(r => setTimeout(r, 200));

  ws.close();

  console.log('\n========================================================');
  console.log('🎉 ALL PHASE 6 POWER & TIMED SHUTDOWN CHECKS PASSED!');
  console.log('========================================================');
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Phase 6 Verification Failed:', err);
    process.exit(1);
  });

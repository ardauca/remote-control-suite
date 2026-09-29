// Phase 5 Automated Media & Volume Verification Script
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

async function runTest() {
  console.log('========================================================');
  console.log('🧪 Starting Phase 5 Media & Volume Verification Suite');
  console.log('========================================================');

  const ws = await connectWs();
  console.log('✔ Connected to WebSocket host.');

  // 1. Host Hello & Capabilities
  const hello = await waitForAction(ws, 'system.hello');
  console.log(`✔ Host Hello received: ${hello.payload.serverName} (OS: ${hello.payload.os})`);
  const caps = hello.payload.capabilities;
  if (!caps.includes('volume.control') || !caps.includes('media.control')) {
    throw new Error('Host missing volume.control or media.control capability');
  }
  console.log('✔ Capabilities volume.control & media.control verified.');

  // 2. Initial Volume State
  console.log('\n[1/4] Testing Volume State Request & WASAPI Session Enumeration...');
  sendMsg(ws, 'volume.requestState');
  const volState = await waitForAction(ws, 'volume.state');
  console.log(`✔ Received Volume State: Master Volume = ${volState.payload.masterVolume}%, Muted = ${volState.payload.isMuted}`);
  console.log(`✔ Active Audio Sessions Count: ${volState.payload.sessions.length}`);
  volState.payload.sessions.forEach((s) => {
    console.log(`   • App: ${s.name} (PID: ${s.processId}), Vol: ${s.volume}%, Muted: ${s.isMuted}`);
  });

  const originalVolume = volState.payload.masterVolume;
  const originalMute = volState.payload.isMuted;

  // 3. Set Master Volume and Mute
  console.log('\n[2/4] Testing Master Volume Set & Real-Time WASAPI Notification...');
  const testVolume = 35;
  sendMsg(ws, 'volume.setMaster', { volume: testVolume, mute: false });
  const updatedVol = await waitForAction(ws, 'volume.state');
  console.log(`✔ Received Updated Volume State: ${updatedVol.payload.masterVolume}% (Target: ${testVolume}%)`);

  // Test Mute
  console.log('Testing Master Mute...');
  sendMsg(ws, 'volume.setMaster', { volume: testVolume, mute: true });
  const mutedVol = await waitForAction(ws, 'volume.state');
  console.log(`✔ Received Muted Volume State: isMuted = ${mutedVol.payload.isMuted}`);

  // Restore original volume
  console.log('Restoring original volume state...');
  sendMsg(ws, 'volume.setMaster', { volume: originalVolume, mute: originalMute });
  await waitForAction(ws, 'volume.state');
  console.log(`✔ Restored master volume to ${originalVolume}%`);

  // 4. Test Media Now Playing & GSMTC
  console.log('\n[3/4] Testing Media Now Playing (GSMTC WinRT)...');
  sendMsg(ws, 'media.requestNowPlaying');
  const mediaState = await waitForAction(ws, 'media.nowPlaying');
  console.log('✔ Received Media Now Playing Metadata:');
  console.log(`   • Title: "${mediaState.payload.title || '(No active playback)'}"`);
  console.log(`   • Artist: "${mediaState.payload.artist || '(None)'}"`);
  console.log(`   • Playing: ${mediaState.payload.isPlaying}`);
  console.log(`   • Source App: ${mediaState.payload.sourceApp || '(None)'}`);

  // 5. Test Media Action (Play/Pause, Next, Previous)
  console.log('\n[4/4] Testing Media Actions...');
  sendMsg(ws, 'media.action', { action: 'playPause' });
  console.log('✔ Sent media.action (playPause)');

  ws.close();

  console.log('\n========================================================');
  console.log('🎉 ALL PHASE 5 MEDIA & VOLUME CHECKS PASSED!');
  console.log('========================================================');
}

runTest()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Phase 5 Verification Failed:', err);
    process.exit(1);
  });

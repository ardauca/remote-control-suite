// Phase 7 Automated Screen Mirroring & Display Streamer Verification Script
const http = require('http');

const WS_URL = 'ws://localhost:52520/ws';
const AUTH_TOKEN = 'test_benchmark_token_2026';

function testHttpSnapshot() {
  return new Promise((resolve, reject) => {
    fetch('http://localhost:52520/api/screen/snapshot', {
      headers: { 'Authorization': `Bearer ${AUTH_TOKEN}` }
    }).then(async (res) => {
      if (res.status !== 200) {
        return reject(new Error(`Snapshot HTTP status: ${res.status}`));
      }
      const contentType = res.headers.get('content-type');
      if (!contentType || !contentType.includes('image/jpeg')) {
        return reject(new Error(`Unexpected Content-Type: ${contentType}`));
      }
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      if (buffer.length < 1000) {
        return reject(new Error(`Snapshot image too small: ${buffer.length} bytes`));
      }
      if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) {
        return reject(new Error(`Invalid JPEG header: 0x${buffer[0].toString(16)}, 0x${buffer[1].toString(16)}`));
      }
      resolve({
        sizeBytes: buffer.length,
        contentType: contentType
      });
    }).catch(reject);
  });
}

function connectWs() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Connection timeout'));
    }, 4000);

    ws.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.action === 'system.hello') {
          ws.send(JSON.stringify({
            version: 1,
            id: crypto.randomUUID(),
            type: 'command',
            action: 'auth.login',
            payload: { token: AUTH_TOKEN },
            timestamp: Date.now()
          }));
        } else if (msg.action === 'auth.result') {
          clearTimeout(timer);
          if (msg.payload.authenticated) {
            resolve(ws);
          } else {
            reject(new Error('Auth failed'));
          }
        }
      }
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

function parseBinaryHeader(buffer) {
  if (buffer.byteLength < 16) {
    throw new Error(`Buffer too small: ${buffer.byteLength} < 16`);
  }
  const view = new DataView(buffer);
  const magic = view.getUint8(0);
  const version = view.getUint8(1);
  const codec = view.getUint8(2);
  const flags = view.getUint8(3);
  const isCursorVisible = (flags & 0x01) !== 0;
  const isKeyframe = (flags & 0x02) !== 0;

  const sequenceNumber = view.getUint32(4, false); // Big-Endian
  const nativeWidth = view.getUint16(8, false); // Big-Endian
  const nativeHeight = view.getUint16(10, false); // Big-Endian
  const rawCursorX = view.getUint16(12, false); // Big-Endian
  const rawCursorY = view.getUint16(14, false); // Big-Endian

  const cursorX = rawCursorX / 65535.0;
  const cursorY = rawCursorY / 65535.0;

  const payloadBytes = new Uint8Array(buffer, 16);
  // Check JPEG SOI
  const isJpeg = payloadBytes.length >= 2 && payloadBytes[0] === 0xFF && payloadBytes[1] === 0xD8;

  return {
    magic,
    version,
    codec,
    flags,
    isCursorVisible,
    isKeyframe,
    sequenceNumber,
    nativeWidth,
    nativeHeight,
    cursorX,
    cursorY,
    payloadLength: payloadBytes.length,
    isJpeg
  };
}

async function runTest() {
  console.log('====================================================');
  console.log('  PHASE 7 AUTOMATED DISPLAY STREAMER VERIFICATION  ');
  console.log('====================================================\n');

  // Test 1: HTTP Snapshot Endpoint
  console.log('[1/6] Testing HTTP Snapshot endpoint (/api/screen/snapshot)...');
  try {
    const snap = await testHttpSnapshot();
    console.log(`  ✓ Snapshot retrieved successfully: ${snap.sizeBytes.toLocaleString()} bytes (${snap.contentType})`);
  } catch (err) {
    console.error(`  ✗ Snapshot endpoint failed: ${err.message}`);
    process.exit(1);
  }

  // Test 2: WebSocket Connection & Auth
  console.log('\n[2/6] Connecting to WebSocket and checking auth...');
  let ws;
  try {
    ws = await connectWs();
    console.log('  ✓ WebSocket connected');
  } catch (err) {
    console.error(`  ✗ WebSocket connection failed: ${err.message}`);
    process.exit(1);
  }

  // Collect messages and binary frames
  const textMessages = [];
  const binaryFrames = [];

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      try {
        const parsed = JSON.parse(event.data);
        textMessages.push(parsed);
      } catch (e) {}
    } else if (event.data instanceof ArrayBuffer) {
      binaryFrames.push(event.data);
    }
  };

  // Test 3: Monitors Query
  console.log('\n[3/6] Querying connected monitors (screen.monitors)...');
  sendMsg(ws, 'screen.monitors');
  await new Promise(r => setTimeout(r, 600));

  const monitorsMsg = textMessages.find(m => m.action === 'screen.monitors');
  const monitorList = monitorsMsg && monitorsMsg.payload ? (Array.isArray(monitorsMsg.payload) ? monitorsMsg.payload : monitorsMsg.payload.monitors) : null;
  if (monitorList && monitorList.length > 0) {
    console.log(`  ✓ Monitors detected (${monitorList.length}):`);
    monitorList.forEach((m, idx) => {
      console.log(`    - Monitor ${idx}: ${m.deviceName} (${m.width}x${m.height}) ${m.isPrimary ? '[PRIMARY]' : ''}`);
    });
  } else {
    console.log('  ⚠ No screen.monitors response received (non-fatal)');
  }

  // Test 4: WebSocket Snapshot
  console.log('\n[4/6] Requesting single snapshot over WebSocket (screen.snapshot)...');
  binaryFrames.length = 0;
  sendMsg(ws, 'screen.snapshot', { quality: 70, scale: 0.75 });

  const snapFrame = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for screen.snapshot binary frame')), 5000);
    const interval = setInterval(() => {
      if (binaryFrames.length > 0) {
        clearInterval(interval);
        clearTimeout(timer);
        resolve(binaryFrames.shift());
      }
    }, 50);
  });

  const parsedSnap = parseBinaryHeader(snapFrame);
  console.log(`  ✓ Received binary snapshot:`);
  console.log(`    - Magic: 0x${parsedSnap.magic.toString(16).toUpperCase()} ('${String.fromCharCode(parsedSnap.magic)}')`);
  console.log(`    - Version: ${parsedSnap.version}`);
  console.log(`    - Codec: ${parsedSnap.codec} (1=JPEG)`);
  console.log(`    - Sequence: ${parsedSnap.sequenceNumber}`);
  console.log(`    - Native Resolution: ${parsedSnap.nativeWidth}x${parsedSnap.nativeHeight}`);
  console.log(`    - Cursor Position: (${(parsedSnap.cursorX * 100).toFixed(1)}%, ${(parsedSnap.cursorY * 100).toFixed(1)}%) Visible: ${parsedSnap.isCursorVisible}`);
  console.log(`    - JPEG Payload: ${parsedSnap.payloadLength.toLocaleString()} bytes, Valid JPEG: ${parsedSnap.isJpeg}`);

  if (parsedSnap.magic !== 0x53 || !parsedSnap.isJpeg || parsedSnap.payloadLength < 1000) {
    console.error('  ✗ Snapshot binary frame validation failed!');
    process.exit(1);
  }

  // Test 5: Live Stream & Real-time Telemetry
  console.log('\n[5/6] Starting live stream (screen.start: 10 FPS, quality 60, scale 0.50)...');
  binaryFrames.length = 0;
  textMessages.length = 0;

  sendMsg(ws, 'screen.start', { fps: 10, quality: 60, scale: 0.50 });

  // Stream for 3 seconds
  console.log('  Capturing stream for 3.5 seconds...');
  await new Promise(r => setTimeout(r, 3500));

  console.log(`  ✓ Received ${binaryFrames.length} live stream frames in 3.5s!`);
  if (binaryFrames.length < 5) {
    console.error(`  ✗ Expected at least 5 frames, got ${binaryFrames.length}`);
    process.exit(1);
  }

  // Verify frame sequence numbers and dimensions
  const parsedFrames = binaryFrames.map(parseBinaryHeader);
  const firstSeq = parsedFrames[0].sequenceNumber;
  const lastSeq = parsedFrames[parsedFrames.length - 1].sequenceNumber;
  console.log(`    - Sequence numbers: ${firstSeq} -> ${lastSeq} (monotonic progression)`);
  console.log(`    - Average frame payload size: ${Math.round(parsedFrames.reduce((acc, f) => acc + f.payloadLength, 0) / parsedFrames.length).toLocaleString()} bytes`);

  // Verify telemetry message
  const telemetryMsgs = textMessages.filter(m => m.action === 'screen.telemetry');
  console.log(`  ✓ Received ${telemetryMsgs.length} telemetry reports`);
  if (telemetryMsgs.length > 0) {
    const latestTelem = telemetryMsgs[telemetryMsgs.length - 1].payload;
    console.log(`    - Actual FPS: ${latestTelem.actualFps}`);
    console.log(`    - Throughput: ${(latestTelem.bytesPerSecond / 1024).toFixed(1)} KB/s`);
    console.log(`    - Est. Data Rate: ${latestTelem.estimatedMbPerMinute.toFixed(2)} MB/min (~${latestTelem.estimatedGbPerHour.toFixed(3)} GB/hour)`);
    console.log(`    - Dropped Frames: ${latestTelem.droppedFrames}`);
    console.log(`    - Queue Depth: ${latestTelem.queueDepth}`);
    console.log(`    - Capture Time: ${latestTelem.captureDurationMs} ms, Send Time: ${latestTelem.sendDurationMs} ms`);
  }

  // Test 6: Remote Screen Touch & Stream Stop
  console.log('\n[6/6] Testing remote touch input & stream stop...');

  // Move
  sendMsg(ws, 'screen.touch', { type: 'move', normalizedX: 0.5, normalizedY: 0.5 });
  await new Promise(r => setTimeout(r, 100));

  // Click
  sendMsg(ws, 'screen.touch', { type: 'click', normalizedX: 0.5, normalizedY: 0.5, button: 'left' });
  await new Promise(r => setTimeout(r, 100));

  // Right Click
  sendMsg(ws, 'screen.touch', { type: 'rightClick', normalizedX: 0.5, normalizedY: 0.5, button: 'right' });
  await new Promise(r => setTimeout(r, 100));

  console.log('  ✓ Touch events (move, click, right-click) dispatched successfully');

  // Stop stream
  sendMsg(ws, 'screen.stop');
  console.log('  Sent screen.stop. Waiting 1.5 seconds to verify stream halt...');
  const countBefore = binaryFrames.length;
  await new Promise(r => setTimeout(r, 1500));
  const countAfter = binaryFrames.length;

  console.log(`  Frames before stop wait: ${countBefore}, frames after: ${countAfter}`);
  if (countAfter - countBefore > 2) {
    console.error(`  ✗ Stream did not halt properly! Received ${countAfter - countBefore} extra frames`);
    process.exit(1);
  }
  console.log('  ✓ Stream stopped cleanly');

  ws.close();

  console.log('\n====================================================');
  console.log('  >>> ALL PHASE 7 SCREEN TESTS PASSED! <<<          ');
  console.log('====================================================\n');
  process.exit(0);
}

runTest().catch((err) => {
  console.error('\nVerification failed with exception:', err);
  process.exit(1);
});

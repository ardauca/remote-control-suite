// Benchmark Screen Streaming Engine (GDI Capture & JPEG Encoding)
// Tests: 540p @ 8 FPS, 720p @ 15 FPS, 1080p @ 25 FPS

const WS_URL = 'ws://localhost:52520/ws';
const AUTH_TOKEN = 'test_benchmark_token_2026';

const HEADER_SIZE = 16;
const MAGIC_BYTE = 0x53; // 'S'

function decodeBinaryHeader(buffer) {
  if (buffer.byteLength <= HEADER_SIZE) return null;
  const view = new DataView(buffer);
  const magic = view.getUint8(0);
  if (magic !== MAGIC_BYTE) return null;

  return {
    version: view.getUint8(1),
    sequenceNumber: view.getUint32(4, false),
    desktopWidth: view.getUint16(8, false),
    desktopHeight: view.getUint16(10, false),
    imageLength: buffer.byteLength - HEADER_SIZE
  };
}

function connectAndAuth() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.binaryType = 'arraybuffer';

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
          if (msg.payload.authenticated) {
            resolve(ws);
          } else {
            reject(new Error('Authentication failed: ' + msg.payload.message));
          }
        }
      }
    };

    ws.onerror = (err) => reject(err);
  });
}

async function runPresetBenchmark(ws, name, config, durationSeconds = 5) {
  console.log(`\n---------------------------------------------------------`);
  console.log(` Running Benchmark: ${name} (${config.fps} FPS, Scale: ${config.scale}, Quality: ${config.quality}%)`);
  console.log(`---------------------------------------------------------`);

  const frames = [];
  let totalBytes = 0;
  let lastSeq = 0;
  let droppedSequences = 0;
  let lastTelemetry = null;

  const onMessage = (event) => {
    if (typeof event.data !== 'string') {
      const buffer = event.data;
      totalBytes += buffer.byteLength;
      const header = decodeBinaryHeader(buffer);
      if (header) {
        if (lastSeq > 0 && header.sequenceNumber > lastSeq + 1) {
          droppedSequences += (header.sequenceNumber - lastSeq - 1);
        }
        lastSeq = header.sequenceNumber;
        frames.push(header);
      }
    } else {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'screen.telemetry') {
          lastTelemetry = msg.payload;
        }
      } catch {}
    }
  };

  ws.addEventListener('message', onMessage);

  // Send screen.start
  ws.send(JSON.stringify({
    version: 1,
    id: crypto.randomUUID(),
    type: 'command',
    action: 'screen.start',
    payload: {
      fps: config.fps,
      quality: config.quality,
      scale: config.scale,
      monitorIndex: 0
    },
    timestamp: Date.now()
  }));

  const startTime = Date.now();
  await new Promise((r) => setTimeout(r, durationSeconds * 1000));
  const actualDurationMs = Date.now() - startTime;

  // Send screen.stop
  ws.send(JSON.stringify({
    version: 1,
    id: crypto.randomUUID(),
    type: 'command',
    action: 'screen.stop',
    payload: {},
    timestamp: Date.now()
  }));

  ws.removeEventListener('message', onMessage);

  // Settle
  await new Promise((r) => setTimeout(r, 400));

  const totalFrames = frames.length;
  const actualFps = Number((totalFrames / (actualDurationMs / 1000)).toFixed(1));
  const avgFrameSizeKb = totalFrames > 0 ? Number((totalBytes / totalFrames / 1024).toFixed(1)) : 0;
  const kbPerSec = Number((totalBytes / (actualDurationMs / 1000) / 1024).toFixed(1));
  const mbPerMin = Number(((kbPerSec * 60) / 1024).toFixed(2));

  const captureMs = lastTelemetry ? lastTelemetry.captureDurationMs : 0;
  const encodeMs = lastTelemetry ? lastTelemetry.encodeDurationMs : 0;
  const sendMs = lastTelemetry ? lastTelemetry.sendDurationMs : 0;
  const serverDropped = lastTelemetry ? lastTelemetry.droppedFrames : 0;

  console.log(`  Frames Received:     ${totalFrames} (Target: ~${config.fps * durationSeconds})`);
  console.log(`  Actual Frame Rate:   ${actualFps} FPS`);
  console.log(`  Host Capture Time:   ${captureMs} ms`);
  console.log(`  Host Encode Time:    ${encodeMs} ms`);
  console.log(`  Host Send Time:      ${sendMs} ms`);
  console.log(`  Pipeline Latency:    ~${captureMs + encodeMs + sendMs} ms`);
  console.log(`  Average Frame Size:  ${avgFrameSizeKb} KB`);
  console.log(`  Throughput / Stream: ${kbPerSec} KB/s (~${mbPerMin} MB/min)`);
  console.log(`  Server Dropped:      ${serverDropped} (Gaps: ${droppedSequences})`);

  return {
    name,
    targetFps: config.fps,
    actualFps,
    captureMs: `${captureMs}ms`,
    encodeMs: `${encodeMs}ms`,
    sendMs: `${sendMs}ms`,
    totalLatencyMs: `${captureMs + encodeMs + sendMs}ms`,
    avgFrameSizeKb: `${avgFrameSizeKb} KB`,
    kbPerSec: `${kbPerSec} KB/s`,
    mbPerMin: `${mbPerMin} MB/min`,
    dropped: serverDropped
  };
}

async function main() {
  console.log('=========================================================');
  console.log('   Remote Control Suite - Screen Streaming Benchmarks');
  console.log('=========================================================');

  try {
    const ws = await connectAndAuth();
    console.log('✔ Authenticated session established for benchmarking.');

    const r540 = await runPresetBenchmark(ws, '540p / 8 FPS (Mobile)', { fps: 8, scale: 0.55, quality: 45 }, 5);
    const r720 = await runPresetBenchmark(ws, '720p / 15 FPS (Balanced)', { fps: 15, scale: 0.75, quality: 65 }, 5);
    const r1080 = await runPresetBenchmark(ws, '1080p / 25 FPS (High)', { fps: 25, scale: 1.0, quality: 80 }, 5);

    ws.close();

    console.log('\n=========================================================');
    console.log('                 BENCHMARK SUMMARY TABLE                 ');
    console.log('=========================================================');
    console.table([r540, r720, r1080]);
  } catch (err) {
    console.error('Benchmark failed:', err);
    process.exit(1);
  }
}

main();

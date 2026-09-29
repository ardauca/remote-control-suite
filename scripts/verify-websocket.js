// Phase 1 WebSocket Verification Script (Node 24 native WebSocket)

async function testWebSocket() {
  console.log('Connecting to ws://localhost:52520/ws ...');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:52520/ws');
    let receivedHello = false;
    let receivedPong = false;

    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout waiting for WebSocket responses'));
    }, 5000);

    ws.onopen = () => {
      console.log('✔ WebSocket connected successfully.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        console.log(`✔ Received message: action=${msg.action}, type=${msg.type}`);

        if (msg.action === 'system.hello') {
          receivedHello = true;
          console.log('  Server Name:', msg.payload.serverName);
          console.log('  OS:', msg.payload.os);
          console.log('  Capabilities:', msg.payload.capabilities);

          // Now test sending ping
          console.log('Sending system.ping ...');
          ws.send(JSON.stringify({
            version: 1,
            id: 'test-ping-id',
            type: 'heartbeat',
            action: 'system.ping',
            payload: { clientTime: Date.now() },
            timestamp: Date.now()
          }));
        } else if (msg.action === 'system.pong') {
          receivedPong = true;
          const latency = Date.now() - msg.payload.clientTime;
          console.log(`✔ Received system.pong! Round-trip latency: ${latency}ms`);

          if (receivedHello && receivedPong) {
            clearTimeout(timeout);
            ws.close();
            resolve(true);
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };

    ws.onclose = () => {
      console.log('✔ WebSocket closed cleanly.');
    };
  });
}

testWebSocket()
  .then(() => {
    console.log('==========================================');
    console.log('🎉 WEBSOCKET PROTOCOL VERIFICATION PASSED!');
    console.log('==========================================');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ WebSocket test failed:', err);
    process.exit(1);
  });

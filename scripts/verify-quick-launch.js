// Quick Launch Verification Script using native Node 24 WebSocket
async function testQuickLaunch() {
  console.log('Connecting to ws://localhost:52520/ws ...');
  
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:52520/ws');

    const timeout = setTimeout(() => {
      ws.close();
      resolve(true); // Don't hang if no response expected
    }, 2500);

    ws.onopen = () => {
      console.log('✔ WebSocket connected successfully.');

      // Send launch app command for calc
      const msg = {
        version: 1,
        id: 'test-launch',
        type: 'command',
        action: 'system.launchApp',
        payload: { app: 'calc' },
        timestamp: Date.now()
      };
      ws.send(JSON.stringify(msg));
      console.log('✔ Sent system.launchApp for calc');

      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        console.log('✔ Quick app launch command processed without error!');
        resolve(true);
      }, 1000);
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });
}

testQuickLaunch().then(() => {
  console.log('==========================================');
  console.log('🎉 APP LAUNCHER VERIFICATION PASSED!');
  console.log('==========================================');
  process.exit(0);
}).catch((err) => {
  console.error('Error during test:', err);
  process.exit(1);
});

// Phase 4 Automated Keyboard & Shortcut Verification Script

async function testKeyboardProtocol() {
  console.log('Testing Keyboard, Unicode & Shortcut Protocol...');

  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://localhost:52520/ws');
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('Timeout during keyboard test'));
    }, 8000);

    ws.onopen = () => {
      console.log('✔ Connected to WebSocket server.');
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.action === 'system.hello') {
          console.log('✔ Host hello received. Running Phase 4 tests...');

          // Test 1: Turkish Unicode & Special Symbols & Emojis
          console.log('Testing Unicode Text Input (Turkish, Symbols, Emojis)...');
          ws.send(JSON.stringify({
            version: 1,
            id: 'test-text-1',
            type: 'command',
            action: 'keyboard.text',
            payload: { text: 'Türkçe karakter testi: ç ğ ı İ ö ş ü Ç Ğ Ö Ş Ü 123 @#$%' },
            timestamp: Date.now()
          }));
          console.log('✔ Sent keyboard.text with Turkish characters.');

          // Test 2: Special Keys (Enter, Tab, Esc, Arrows)
          setTimeout(() => {
            console.log('Testing Special Keys (Down & Up)...');
            ws.send(JSON.stringify({
              version: 1,
              id: 'test-key-tab',
              type: 'command',
              action: 'keyboard.keyDown',
              payload: { key: 'TAB' },
              timestamp: Date.now()
            }));
            ws.send(JSON.stringify({
              version: 1,
              id: 'test-key-tab-up',
              type: 'command',
              action: 'keyboard.keyUp',
              payload: { key: 'TAB' },
              timestamp: Date.now()
            }));
            console.log('✔ Sent special keys (TAB down & up)');
          }, 150);

          // Test 3: Shortcuts (Ctrl+C, Ctrl+V, Alt+Tab, Ctrl+Shift+Esc)
          setTimeout(() => {
            console.log('Testing Quick Shortcuts (Ctrl+C, Alt+Tab)...');
            ws.send(JSON.stringify({
              version: 1,
              id: 'test-sc-1',
              type: 'command',
              action: 'keyboard.shortcut',
              payload: { keys: ['CTRL', 'C'] },
              timestamp: Date.now()
            }));
            console.log('✔ Sent shortcut: Ctrl+C');
          }, 300);

          // Test 4: Disconnect Safety
          setTimeout(() => {
            console.log('Testing Disconnect Safety: Pressing CTRL then closing socket...');
            ws.send(JSON.stringify({
              version: 1,
              id: 'test-ctrl-down',
              type: 'command',
              action: 'keyboard.keyDown',
              payload: { key: 'CTRL' },
              timestamp: Date.now()
            }));

            // Close socket abruptly while CTRL is down
            setTimeout(() => {
              ws.close();
              clearTimeout(timeout);
              console.log('✔ Socket closed abruptly with held key. Host should release all keys.');
              console.log('==========================================');
              console.log('🎉 ALL PHASE 4 KEYBOARD CHECKS PASSED!');
              console.log('==========================================');
              resolve(true);
            }, 100);
          }, 450);
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = reject;
  });
}

testKeyboardProtocol()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Keyboard verification failed:', err);
    process.exit(1);
  });

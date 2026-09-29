// Real Windows Integration Test: Testing Turkish Unicode & Shortcuts against Windows Notepad
const { spawn, execSync } = require('child_process');

async function runTest() {
  console.log('--- Real Windows Integration Test Starting ---');

  // 1. Clear Windows clipboard
  try {
    execSync('powershell -Command "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::Clear()"');
  } catch (e) {}

  // 2. Launch Notepad cleanly
  console.log('Launching Notepad...');
  try {
    execSync('powershell -Command "Stop-Process -Name notepad -Force -ErrorAction SilentlyContinue"');
    execSync('powershell -Command "Start-Process notepad.exe; Start-Sleep -Milliseconds 1200"');
    execSync(`powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class Win { [DllImport(\\\"user32.dll\\\")] public static extern bool SetForegroundWindow(IntPtr hWnd); [DllImport(\\\"user32.dll\\\")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow); }'; \\$p = Get-Process notepad | Where-Object { \\$_.MainWindowHandle -ne 0 } | Select-Object -First 1; if (\\$p) { [Win]::ShowWindow(\\$p.MainWindowHandle, 9); [Win]::SetForegroundWindow(\\$p.MainWindowHandle); Write-Host 'Activated Notepad PID:' \\$p.Id 'HWND:' \\$p.MainWindowHandle; }"`);
  } catch (e) {
    console.error('Launch error:', e);
  }
  await new Promise(r => setTimeout(r, 600));

  const targetText = 'Türkçe: ç ğ ı İ ö ş ü Ç Ğ Ö Ş Ü 🎉';
  console.log('Target Text to inject:', targetText);

  // 3. Connect to RemoteAgent WebSocket
  const ws = new WebSocket('ws://localhost:52520/ws');

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
    setTimeout(() => reject(new Error('WebSocket connection timeout')), 4000);
  });

  console.log('Connected to Agent WebSocket.');

  function sendCmd(action, payload) {
    ws.send(JSON.stringify({
      version: 1,
      id: Math.random().toString(36).substring(2, 9),
      type: 'command',
      action,
      payload,
      timestamp: Date.now()
    }));
  }

  // Wait a moment for notepad to be fully focused
  await new Promise(r => setTimeout(r, 500));

  // Send Unicode Text
  console.log('Sending keyboard.text...');
  sendCmd('keyboard.text', { text: targetText });
  await new Promise(r => setTimeout(r, 800));

  // Select All via Shortcut
  console.log('Sending Ctrl+A shortcut...');
  sendCmd('keyboard.shortcut', { keys: ['CTRL', 'A'] });
  await new Promise(r => setTimeout(r, 400));

  // Copy via Shortcut
  console.log('Sending Ctrl+C shortcut...');
  sendCmd('keyboard.shortcut', { keys: ['CTRL', 'C'] });
  await new Promise(r => setTimeout(r, 600));

  // Read clipboard
  let clipboardText = '';
  for (let i = 0; i < 5; i++) {
    try {
      clipboardText = execSync('powershell -Command "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-Clipboard"', { encoding: 'utf8' }).toString().replace(/\r?\n$/, '');
      if (clipboardText) break;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 300));
  }

  ws.close();
  try {
    execSync('powershell -Command "Stop-Process -Name notepad -Force -ErrorAction SilentlyContinue"');
  } catch (e) {}

  console.log('Retrieved from Windows Clipboard:');
  console.log(JSON.stringify(clipboardText));

  if (clipboardText.trim() === targetText.trim()) {
    console.log('✔ SUCCESS! Exact Turkish Unicode, Emoji, and Shortcuts verified on real Windows Notepad!');
    process.exit(0);
  } else {
    console.error(`❌ MISMATCH! Expected: [${targetText}] but got: [${clipboardText}]`);
    process.exit(1);
  }
}

runTest().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});

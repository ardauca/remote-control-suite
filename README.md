# iPhone → Windows Remote Control Suite

[![.NET 9](https://img.shields.io/badge/.NET-9.0-512bd4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20%7C%20iOS%20Safari-0078d4?style=flat-square)](https://github.com/ardauca/remote-control-suite)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

Production-quality, ultra low-latency, zero-cloud PC remote control platform for iPhone (Safari / PWA) and Windows 10/11. No App Store account, no paid developer licenses, no third-party cloud servers, and no subscriptions required.

---

## 🚀 Key Features

* **Zero Cloud & Private:** Everything runs directly on your local Wi-Fi network (LAN) over high-performance WebSockets.
* **Ultra-Low Latency Mouse & Touchpad:**
  * Precision relative cursor tracking via Win32 `SetCursorPos` and `mouse_event`.
  * Multi-touch gestures: single-tap left click, two-finger right click, two-finger vertical scrolling with inertia.
  * Drag & Drop lock mode with physical haptic vibration feedback.
  * Customizable cursor sensitivity and scroll invert options.
* **Virtual Keyboard & Unicode Engine:**
  * Native iOS virtual keyboard trigger.
  * Full Unicode support (`KEYEVENTF_UNICODE`) — type Turkish characters (`ç, ğ, ı, İ, ö, ş, ü`), symbols, and emojis accurately into any active Windows application.
  * Modifier key engine (`CTRL`, `ALT`, `SHIFT`, `WIN`) supporting sticky and locked states.
  * Dedicated function row (F1–F12) and special navigation keys (`ESC`, `ENTER`, `TAB`, `BACKSPACE`, arrows, `HOME`, `END`, `PAGE UP/DOWN`).
  * Quick Windows shortcuts (`Ctrl+C`, `Ctrl+V`, `Alt+Tab`, `Win+D`, `Win+L`, `Ctrl+Shift+Esc`, etc.).
  * Custom user-defined macro and combination creator with persistent browser storage.
  * Disconnect safety: automatically releases all held modifier keys if connection drops.
* **Native Windows Host Dashboard:**
  * Sleek dark-mode Windows Forms dashboard and System Tray (`NotifyIcon`) integration.
  * Real-time connected client monitor and live event activity log.
  * One-click "Start with Windows" auto-boot registry integration (`HKCU\...\Run`).
  * Quick URL and IP copying for seamless pairing.
* **Progressive Web App (PWA):**
  * Installable directly to iPhone Home Screen via Safari Share menu.
  * Full-screen standalone mode with zero browser address bar distractions and safe-area notch adaptation.

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐           Local Wi-Fi Network (LAN)          ┌──────────────────────────────────┐
│          iPhone (iOS)           │ ◄──────────────────────────────────────────► │           Windows Host           │
│                                 │                                              │                                  │
│  • React 19 + TypeScript + Vite │      HTTP:52520 (Initial PWA bundle)         │  • ASP.NET Core Kestrel Host     │
│  • Zustand State Management     │                                              │  • AgentWebSocketManager         │
│  • Pointer Events & Gestures    │      WS:52520/ws (Binary/JSON frames)        │  • WindowsInputSimulator (Win32) │
│  • iOS Vibration Haptics        │ ───────────────────────────────────────────► │  • System Tray & Dashboard       │
└─────────────────────────────────┘                                              └──────────────────────────────────┘
```

---

## ⚡ Quick Start

### 1. Prerequisites
* **Windows 10 / 11** (64-bit)
* [.NET 9.0 SDK](https://dotnet.microsoft.com/download/dotnet/9.0) (for building from source)
* [Node.js 20+](https://nodejs.org/) (for client development)

### 2. Run Directly on Windows
1. Double-click **`Remote Control.lnk`** on your Desktop or run [start-agent.bat](file:///start-agent.bat).
2. The agent dashboard will open and appear in your Windows System Tray (near the clock).
3. Check the **"Start with Windows"** box if you'd like the agent to automatically run in the background whenever your PC boots.

### 3. Connect from iPhone
1. Ensure your iPhone is connected to the **same Wi-Fi network** as your PC.
2. Open **Safari** and navigate to the address shown on the Windows Dashboard:
   ```
   http://<YOUR_PC_LOCAL_IP>:52520
   ```
3. Tap the **Share** button in Safari and choose **"Add to Home Screen"** (*Ana Ekrana Ekle*).
4. Launch the app from your home screen for a full-screen, native-feeling remote control experience!

---

## 🛠️ Building from Source

### Clone the Repository
```bash
git clone https://github.com/ardauca/remote-control-suite.git
cd remote-control-suite
```

### Build Client & Host
```bash
# 1. Build the React PWA frontend (outputs directly to server's wwwroot)
cd client
npm install
npm run build

# 2. Build and run the Windows Agent
cd ../server/RemoteAgent
dotnet build
dotnet run
```

### Publish Self-Contained Release
```bash
dotnet publish server/RemoteAgent/RemoteAgent.csproj -c Release -o publish
```

---

## 🧪 Automated Verification Suite

Run automated integration and protocol tests while the Windows agent is active:

```bash
# Verify Health HTTP endpoint and PWA bundle serving
node scripts/verify-phase1.js

# Verify WebSocket handshake and ping/pong latency
node scripts/verify-websocket.js

# Verify Win32 mouse cursor movement and scrolling
node scripts/verify-mouse.js

# Verify Unicode text injection, special keys, shortcuts, and safety release
node scripts/verify-keyboard.js

# Verify Windows WASAPI master volume, application mixer, and GSMTC media control
node scripts/verify-media-volume.js

# Verify Windows power management, timed shutdown scheduler, and system controls
node scripts/verify-power.js
```

---

## 🗺️ Roadmap & Phases

- [x] **Phase 0:** Architecture, protocol specification v1, and threat model.
- [x] **Phase 1:** Core .NET 9 Kestrel agent, System Tray, React 19 PWA, heartbeat & auto-reconnect.
- [x] **Phase 3:** High-precision relative mouse control, multi-touch gestures, drag lock, and haptics.
- [x] **Phase 4:** Virtual keyboard, Unicode text input, modifier engine, quick shortcuts, custom macros.
- [x] **Phase 5:** Windows Media Control & Volume Mixer (WASAPI & GSMTC session integration).
- [x] **Phase 6:** Windows System Controls & Timed Shutdown (Power/Sleep/Lock, Task Manager, Timed Shutdown Scheduler).
- [ ] **Phase 7:** Display Streamer & Ultra-Low Latency Screen Mirroring.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).

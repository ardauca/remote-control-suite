# iPhone → Windows Remote Control Suite

[![.NET 9](https://img.shields.io/badge/.NET-9.0-512bd4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![React 19](https://img.shields.io/badge/React-19.0-61dafb?style=flat-square&logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178c6?style=flat-square&logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4-38bdf8?style=flat-square&logo=tailwindcss)](https://tailwindcss.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20%7C%20iOS%20Safari-0078d4?style=flat-square)](https://github.com/ardauca/remote-control-suite)
[![Security](https://img.shields.io/badge/Security-PIN%20Pairing%20%2B%20Token%20Auth-emerald?style=flat-square)](docs/PROTOCOL.md)
[![License](https://img.shields.io/badge/License-MIT-green.svg?style=flat-square)](LICENSE)

Secure, measured, maintainable LAN-first PC remote control application for iPhone (Safari / PWA) and Windows 10/11. Zero cloud accounts, zero third-party relay servers, zero telemetry tracking, and zero subscriptions required.

---

## 🔒 Security Architecture & LAN Pairing

The remote control attack surface is hardened with defense-in-depth:

* **Mandatory Authentication:** Every WebSocket connection must authenticate before privileged commands are executed. Unauthenticated sockets are restricted solely to `system.ping`, `auth.pair`, `auth.login`, and `auth.status`.
* **LAN PIN Pairing Flow:**
  1. The Windows agent generates a cryptographically random 6-digit numeric PIN on startup.
  2. The iPhone client displays a pairing prompt upon connecting to the local IP.
  3. The server validates the PIN using constant-time timing-safe comparisons (`CryptographicOperations.FixedTimeEquals`).
  4. On successful pairing, the server generates a 256-bit cryptographically secure session token and stores only its SHA-256 hash in `%LocalAppData%\RemoteControlSuite\pairings.json`.
  5. Brute-force lockout: 5 failed attempts from an IP address triggers a 5-minute lockout.
* **Capability-Based Authorization:** Operations are partitioned into capabilities (`input.control`, `media.control`, `volume.control`, `power.control`, `screen.read`).
* **Multi-Tier Token-Bucket Rate Limiting:**
  * Mouse movement: 120 events/sec
  * Clicks & Keys: 60 burst, 40 events/sec
  * Text & Shortcuts: 15 burst, 10 events/sec
  * Power & Launch Commands: 2 burst, 1 per 2.5s
  * Screen Streaming Requests: 5 burst, 4 requests/sec
* **Input Clamping & Validation:** Strict clamping on coordinate deltas, whitelist validation for keys and mouse buttons, payload size checks, and screen parameter range enforcement.
* **Disconnect Safety Release:** Automatically releases all remote held keyboard modifier keys (`CTRL`, `ALT`, `SHIFT`, `WIN`) and mouse buttons (`LEFT`, `RIGHT`, `MIDDLE`) whenever a client disconnects.
* **Restrictive Private LAN CORS:** Limits HTTP access to local loopback and RFC 1918 private LAN IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16).
* **Restricted Snapshot Endpoint:** `/api/screen/snapshot` requires a valid `Authorization: Bearer <TOKEN>` header or authenticated token parameter.

---

## 📊 Measured Performance Benchmarks

Rather than unverified marketing claims like "zero latency", this project benchmarks real performance metrics over standard 5 GHz Wi-Fi:

### Screen Streaming Pipeline Benchmarks (GDI Capture + JPEG Encoding)

| Preset | Target Resolution | Target FPS | Actual FPS | Host Capture | Host Encode | Total Pipeline Latency | Avg Frame Size | Network Throughput | Dropped Frames |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Mobile** | 540p (0.55x) | 8 FPS | **9.2 FPS** | ~23 ms | ~1 ms | **~24 ms** | 39.5 KB | 363 KB/s (~21 MB/min) | **0** |
| **Balanced** | 720p (0.75x) | 15 FPS | **12.6 FPS** | ~26 ms | ~3 ms | **~29 ms** | 84.1 KB | 1059 KB/s (~62 MB/min) | **0** |
| **High Wi-Fi** | 1080p (1.00x) | 25 FPS | **21.1 FPS** | ~18 ms | ~4 ms | **~22 ms** | 193.1 KB | 4080 KB/s (~239 MB/min) | **0** |

*Measured on Windows 10/11 Host (Intel/AMD x64, 1080p desktop) with Node.js automated benchmark client.*

---

## 🚀 Key Features

* **Relative Mouse & Touchpad:**
  * Sub-pixel delta coalescing via `requestAnimationFrame` to eliminate jitter.
  * Multi-touch gestures: single-tap left click, two-finger right click, two-finger scrolling.
  * Drag & Drop lock mode with physical vibration haptics.
* **Virtual Keyboard & Unicode Engine:**
  * Full Turkish character support (`ç, ğ, ı, İ, ö, ş, ü`), symbols, and emojis via Win32 `KEYEVENTF_UNICODE`.
  * Modifier key engine (`CTRL`, `ALT`, `SHIFT`, `WIN`) supporting sticky and locked states.
  * Function keys (F1–F12), navigation keys, and customizable macros.
* **WASAPI Audio Mixer & GSMTC Media Controls:**
  * Master volume slider and instant mute toggle.
  * Per-application volume control (Chrome, Spotify, YouTube Music, Discord, etc.).
  * Real-time metadata tracking (Track, Artist, Album) via Windows System Media Transport Controls (GSMTC).
* **System Controls & Timed Shutdown Scheduler:**
  * Quick workstation actions: Lock (`Win+L`), Sleep, Display Off, Task Manager, Show Desktop (`Win+D`), Screenshot.
  * Scheduled shutdown or restart timer with confirmation modal and live countdown.
* **Low-Latency Screen Mirroring & Display Streamer:**
  * Latest-frame-wins architecture with atomic swapping (no unbounded frame queuing).
  * Hardware SVG vector cursor overlay rendered on client side for razor-sharp fidelity without JPEG artifacts.
  * Hardware-accelerated image decoding using `createImageBitmap` on supported browsers.
  * Zero-obstruction fullscreen mode with 90° rotation support for landscape viewing.
  * Comprehensive in-app telemetry breakdown (Capture, Encode, Send, Client Decode, RTT, Dropped Frames).
* **Native Windows Tray & Dashboard:**
  * Dark-mode dashboard showing current pairing PIN, connected devices, active sessions, and live logs.
  * Device revocation button to instantly invalidate compromised tokens.
  * Automatic boot option ("Start with Windows").

---

## 🏗️ Architecture

```
┌─────────────────────────────────┐           Local Wi-Fi Network (LAN)          ┌──────────────────────────────────┐
│          iPhone (iOS)           │ ◄──────────────────────────────────────────► │           Windows Host           │
│                                 │                                              │                                  │
│  • React 19 + TypeScript + Vite │      HTTP:52520 (PWA bundle & Snapshot)      │  • ASP.NET Core Kestrel Host     │
│  • Zustand State Management     │                                              │  • AgentWebSocketManager         │
│  • Binary Frame Decoder         │      WS:52520/ws (Authenticated JSON RPC)    │  • PairingManager (PIN & Tokens) │
│  • SVG Vector Cursor Overlay    │ ◄──────────────────────────────────────────► │  • ConnectionRateLimiter         │
│  • RequestAnimationFrame Coalesc│      WS:52520/ws (16-byte binary screen)     │  • WindowsInputSimulator (Win32) │
│  • Safe-Area & Fullscreen       │ ◄─────────────────────────────────────────── │  • ScreenStreamCoordinator (GDI) │
│  • iOS Vibration Haptics        │                                              │  • WASAPI & GSMTC Media Engine   │
└─────────────────────────────────┘                                              └──────────────────────────────────┘
```

---

## ⚡ Quick Start

### 1. Run on Windows
1. Double-click `publish\RemoteAgent.exe` (or your desktop shortcut).
2. The agent runs as a clean, native Windows application without any CMD/console windows.
3. Closing the dashboard with **X** minimizes it directly to the **System Tray**, keeping Kestrel and your iPhone connection alive.
4. If **"Start with Windows"** is enabled, Remote Agent starts silently in the System Tray on PC boot (`--tray`), ready for instant connection.
5. To reopen the dashboard, double-click the system tray icon or right-click → **Open Dashboard**. To quit completely, choose **Exit**.

### 2. Connect from iPhone
1. Ensure your iPhone is connected to the same Wi-Fi network.
2. Open Safari and navigate to:
   ```
   http://<YOUR_PC_LOCAL_IP>:52520
   ```
3. Enter the 6-digit Pairing PIN shown on your PC dashboard.
4. Tap **Share** → **"Add to Home Screen"** (*Ana Ekrana Ekle*) to install as a standalone PWA.

---

## 🛠️ Building & Verification

### Build Client
```bash
cd client
npm install
npm run build
```

### Build & Run Windows Host
```bash
cd ../server/RemoteAgent
dotnet build
dotnet run
```

### Publish Self-Contained Binary
```bash
dotnet publish server/RemoteAgent/RemoteAgent.csproj -c Release -o publish
```

### Automated Test Suite
```bash
# 1. Verify Authentication, Security & Capability Enforcement
node scripts/verify-auth-security.js

# 2. Verify Token-Bucket Rate Limiting Under Rapid Burst
node scripts/verify-rate-limiting.js

# 3. Benchmark Screen Streaming Latency, Frame Rates & Bandwidth
node scripts/benchmark-screen.js

# 4. Verify Display Streamer & Snapshot Endpoint
node scripts/verify-screen.js

# 5. Verify Core Health API & PWA Serving
node scripts/verify-phase1.js
```

---

## 📄 License
This project is licensed under the [MIT License](LICENSE).

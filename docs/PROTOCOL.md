# Remote Control Suite - Network Protocol Specification v1

## 1. Architecture & Overview
Communication between the iPhone client (Safari / PWA) and the Windows Host Agent is handled over a LAN-first WebSocket connection.

* **Transport:** WebSocket (`ws://` / `wss://`) & REST API (`http://` / `https://`)
* **Default Port:** `52520` (Configurable via `appsettings.json`)
* **REST Endpoints:**
  * Health / Discovery: `GET /api/health`
  * Screen Snapshot: `GET /api/screen/snapshot` (Requires `Authorization: Bearer <TOKEN>` header or `?token=<TOKEN>`)
* **WebSocket Endpoint:** `GET /ws`

---

## 2. Message Framing & Envelope
All JSON messages adhere to the standardized versioned envelope format:

```typescript
export interface MessageEnvelope<T = unknown> {
  version: 1;                 // Protocol version (integer, must be 1)
  id: string;                 // RFC 4122 v4 UUID generated via crypto.randomUUID()
  type: 'command' | 'event' | 'response' | 'heartbeat';
  action: string;             // Action identifier (e.g. 'auth.pair', 'mouse.move')
  payload: T;                 // Action-specific payload
  timestamp: number;          // Unix timestamp in milliseconds
}
```

---

## 3. Security, LAN Pairing & Capability Authorization

### 3.1 Unauthenticated State
Upon WebSocket connection, the socket starts in an **Unauthenticated** state.
Only the following actions are permitted for unauthenticated sockets:
- `system.ping` (Heartbeat)
- `auth.pair` (LAN PIN pairing)
- `auth.login` (Session token authentication)
- `auth.status` (Query current session status)

All other privileged actions return `system.error` with code `UNAUTHORIZED`.

### 3.2 LAN PIN Pairing Flow (`auth.pair`)
1. Windows host generates a cryptographically secure 6-digit numeric PIN displayed on the tray dashboard.
2. The iPhone user enters the PIN.
3. Client sends `auth.pair`:
```json
{
  "version": 1,
  "id": "c85d7751-2e63-4927-b50a-e83fa2faec1e",
  "type": "command",
  "action": "auth.pair",
  "payload": {
    "pin": "482915",
    "deviceName": "iPhone 15 Pro Safari"
  },
  "timestamp": 1727622000100
}
```
4. Server validates PIN using constant-time timing-safe comparison (`CryptographicOperations.FixedTimeEquals`).
5. On success, server generates a 256-bit cryptographically secure session token, stores its SHA-256 hash in `%LocalAppData%\RemoteControlSuite\pairings.json`, and returns:
```json
{
  "version": 1,
  "id": "90b1a0cb-4654-46c5-8495-2c81e890209e",
  "type": "response",
  "action": "auth.result",
  "payload": {
    "authenticated": true,
    "token": "4a7b98f2e...",
    "deviceId": "a93c72b1...",
    "deviceName": "iPhone 15 Pro Safari",
    "capabilities": ["input.control", "media.control", "volume.control", "power.control", "screen.read"],
    "message": "Pairing successful"
  },
  "timestamp": 1727622000200
}
```
6. **Brute-Force Protection:** 5 consecutive failed PIN attempts from an IP address triggers a 5-minute lockout.

### 3.3 Subsequent Session Login (`auth.login`)
Subsequent connections present the saved persistent token:
```json
{
  "version": 1,
  "id": "e4299b64-58e1-4566-a36c-2f9c8d234567",
  "type": "command",
  "action": "auth.login",
  "payload": {
    "token": "4a7b98f2e..."
  },
  "timestamp": 1727622000300
}
```

### 3.4 Capabilities
Privileged operations are segmented into distinct capability gates:
- `input.control`: Mouse movement, clicks, scrolling, keyboard keys, text injection, screen touch
- `media.control`: Media play/pause/skip/previous/stop
- `volume.control`: Master volume, session volume, muting
- `power.control`: Shutdown, restart, lock, sleep, display off, launch app
- `screen.read`: Screen streaming (`screen.start`), snapshots (`screen.snapshot`)

---

## 4. Rate Limiting Specification
The host enforces per-connection token-bucket rate limits before command dispatch:

| Tier | Operations | Burst Capacity | Refill Rate | Limit Action |
|------|------------|----------------|-------------|--------------|
| **Mouse Move** | `mouse.move` | 120 tokens | 120 / sec | Drop excess, return `RATE_LIMITED` |
| **Input Events** | `mouse.click`, `mouse.down`, `mouse.up`, `mouse.scroll`, `keyboard.keyDown`, `keyboard.keyUp`, `screen.touch` | 60 tokens | 40 / sec | Drop excess, return `RATE_LIMITED` |
| **Text / Shortcut** | `keyboard.text`, `keyboard.shortcut` | 15 tokens | 10 / sec | Drop excess, return `RATE_LIMITED` |
| **Power / System** | `power.action`, `power.schedule`, `system.launchApp` | 2 tokens | 0.4 / sec (1 per 2.5s) | Reject with `RATE_LIMITED` |
| **Screen Requests** | `screen.start`, `screen.snapshot` | 5 tokens | 4 / sec | Reject with `RATE_LIMITED` |

---

## 5. Input Validation Rules
Incoming messages undergo strict validation:
* `dx`, `dy`: Clamped to `[-2000, 2000]`
* `button`: Whitelisted to `'left' | 'right' | 'middle'`
* `keyboard.text`: String length clamped to max 2000 characters
* `keyboard.shortcut`: Maximum 8 keys, each key validated against Win32 virtual-key whitelist
* `power.schedule.timeoutSeconds`: Clamped to `[10, 86400]` (10s to 24h)
* `screen.start.fps`: Clamped to `[1, 30]`
* `screen.start.quality`: Clamped to `[10, 100]`
* `screen.start.scale`: Clamped to `[0.25, 1.0]`

---

## 6. Binary Screen Streaming Specification

### 6.1 Architecture: Latest Frame Wins
The screen streaming coordinator implements zero-queue frame replacement:
1. The capture loop grabs desktop pixels and encodes to JPEG.
2. The encoded packet is atomically exchanged into `session.LatestUnsentPacket`.
3. If a prior unsent frame was waiting in the slot, it is dropped in favor of the newer frame.
4. The sender loop pops and transmits the latest frame over WebSocket as binary data (`WebSocketMessageType.Binary`).

### 6.2 16-Byte Binary Frame Header Format
Every binary message consists of a 16-byte fixed header followed by raw compressed JPEG bytes:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|  Magic (0x53) |  Version (1)  |   Codec (1)   |     Flags     |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                   Sequence Number (Big-Endian)                |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|       Desktop Width (uint16)  |      Desktop Height (uint16)  |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|     Cursor Norm X (0-65535)   |     Cursor Norm Y (0-65535)   |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| ... Raw JPEG Payload Bytes (imageLength = Total - 16 bytes) ... |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

* **Byte 0:** Magic Byte (`0x53` = `'S'`)
* **Byte 1:** Version (`0x01`)
* **Byte 2:** Codec (`0x01` = JPEG)
* **Byte 3:** Flags:
  * Bit 0 (`0x01`): Cursor Visible
  * Bit 1 (`0x02`): Is Keyframe (Always 1 for JPEG)
* **Bytes 4-7:** Monotonic Sequence Counter (uint32)
* **Bytes 8-9:** Native Desktop Width (uint16)
* **Bytes 10-11:** Native Desktop Height (uint16)
* **Bytes 12-13:** Hardware Cursor Normalized X (`0` to `65535` -> `x / 65535.0`)
* **Bytes 14-15:** Hardware Cursor Normalized Y (`0` to `65535` -> `y / 65535.0`)
* **Bytes 16+:** Compressed JPEG Image Stream

### 6.3 Real Telemetry (`screen.telemetry`)
Emitted by the server every 1000ms to active streaming clients:
```json
{
  "version": 1,
  "id": "...",
  "type": "event",
  "action": "screen.telemetry",
  "payload": {
    "actualFps": 21,
    "droppedFrames": 0,
    "bytesPerSecond": 4180000,
    "estimatedMbPerMinute": 239.1,
    "estimatedGbPerHour": 14.34,
    "queueDepth": 0,
    "captureDurationMs": 18,
    "encodeDurationMs": 4,
    "sendDurationMs": 0
  },
  "timestamp": 1727622001000
}
```

---

## 7. Error Codes
When an operation fails or is rejected, the server returns a `system.error` envelope:

* `UNAUTHORIZED`: Authentication required (invoke `auth.pair` or `auth.login`).
* `FORBIDDEN`: Client lacks required capability.
* `RATE_LIMITED`: Request exceeded token bucket rate limits.
* `BAD_REQUEST`: Malformed JSON, missing action, or unsupported protocol version.
* `INVALID_PARAM`: Parameter outside permitted ranges.
* `INVALID_KEY`: Unrecognized or unmapped keyboard key.
* `INVALID_SHORTCUT`: Shortcut exceeds 8 keys or contains unmapped keys.
* `INTERNAL_ERROR`: Unexpected host exception.

# Remote Control Suite - Network Protocol Specification v1

## 1. Overview
The communication between the iPhone Web Client (Safari / PWA) and the Windows Agent Host is handled over a persistent WebSocket connection.

* **Default Port:** `52520` (Configurable via `appsettings.json`)
* **Base URL:** `http://<PC_LOCAL_IP>:52520`
* **WebSocket Endpoint:** `ws://<PC_LOCAL_IP>:52520/ws`
* **Health API:** `http://<PC_LOCAL_IP>:52520/api/health`

---

## 2. Message Envelope
All standard control and status messages are serialized as JSON adhering to the following structure:

```typescript
export interface MessageEnvelope<T = unknown> {
  version: 1;                 // Protocol version (integer)
  id: string;                 // Unique message ID (UUID v4)
  type: 'command' | 'event' | 'response' | 'heartbeat';
  action: string;             // Action identifier (e.g. 'system.ping', 'mouse.move')
  payload: T;                 // Action-specific payload object
  timestamp: number;          // Unix timestamp in milliseconds
}
```

---

## 3. Phase 1 Core Protocol Actions

### 3.1 Heartbeat & Latency Measurement
#### Client Ping:
```json
{
  "version": 1,
  "id": "e4299b64-58e1-4566-a36c-2f9c8d234567",
  "type": "heartbeat",
  "action": "system.ping",
  "payload": {
    "clientTime": 1727622000100
  },
  "timestamp": 1727622000100
}
```

#### Host Pong Response:
```json
{
  "version": 1,
  "id": "78a9c3b1-d365-4f32-824c-982143098124",
  "type": "heartbeat",
  "action": "system.pong",
  "payload": {
    "clientTime": 1727622000100,
    "serverTime": 1727622000102
  },
  "timestamp": 1727622000102
}
```
*Round-trip latency:* `currentTimestamp - payload.clientTime`

---

### 3.2 System Status & Hello Handshake
Upon WebSocket connection establishment, the Host sends a `system.hello` event:
```json
{
  "version": 1,
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "type": "event",
  "action": "system.hello",
  "payload": {
    "serverName": "DESKTOP-ARDA",
    "version": "1.0.0",
    "os": "Windows 11 (10.0.22631)",
    "capabilities": [
      "system.status",
      "mouse.control",
      "keyboard.control",
      "media.control",
      "volume.control",
      "power.control"
    ]
  },
  "timestamp": 1727622000000
}
```

---

## 4. Error Handling
If an invalid message or unauthorized command is received, the Host responds with:
```json
{
  "version": 1,
  "id": "...",
  "type": "response",
  "action": "system.error",
  "payload": {
    "code": "BAD_REQUEST | UNAUTHORIZED | INTERNAL_ERROR",
    "message": "Human readable error description",
    "originalAction": "..."
  },
  "timestamp": 1727622000200
}
```

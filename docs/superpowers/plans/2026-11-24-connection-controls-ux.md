# Connection and Controls UX Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan task by task. Steps use checkbox syntax for tracking.

**Goal:** Make the iPhone app show whether the Windows host is responsive and keep remote input from appearing to succeed while it is not.

**Architecture:** Keep WebSocket transport state separate from heartbeat responsiveness in the client store. Use that state in the global connection indicator, access gate, and keyboard draft/retry flow; do not change the server or wire protocol.

**Tech Stack:** React, TypeScript, Zustand, Vite, ASP.NET Core Windows host (unchanged).

**Spec:** `docs/superpowers/specs/2026-11-24-connection-controls-ux-design.md`

## Global Constraints

- Existing launch behavior and bottom navigation remain unchanged.
- No wire protocol changes or third-party packages.
- The host heartbeat interval is four seconds and the current watchdog threshold is 25 seconds.
- Exact labels and colors should follow the current visual system and clearly distinguish transport-open from host-responsive.
- Keep an unsent keyboard draft and require an explicit retry; do not replay text automatically because there is no delivery acknowledgment.

## Review Focus

- A socket opens but never returns a pong: the UI must leave the checking state, gate controls, and offer recovery before the 25-second watchdog reconnect.
- The app resumes from iOS background with a stale socket: show checking immediately and accept controls only after a fresh pong.
- A stale connection recovers before the watchdog: restore controls on the next pong without requiring a manual reconnect.
- A user is paired in storage but the live connection drops: retain existing pairing behavior and avoid showing controls as ready before authentication and responsiveness are both restored.
- Text, dictation, or IME composition is pending when the connection becomes stale: retain the text and require a deliberate retry without clearing it or automatically duplicating it.

---

### Task 1: Track host responsiveness independently from the socket

**Files:**
- Modify: `client/src/protocol/protocolTypes.ts`
- Modify: `client/src/stores/connectionStore.ts`
- Modify: `client/src/protocol/wsClient.ts`

**Interfaces:**
- Produce `HostHealth = 'unknown' | 'checking' | 'responsive' | 'stale'` in `protocolTypes.ts`.
- Produce store state `hostHealth: HostHealth` and action `setHostHealth(health: HostHealth): void`.
- WebSocket open and foreground resume set health to `checking`; a valid `system.pong` sets it to `responsive`; 12 seconds without a pong while connected sets it to `stale`; close/manual disconnect resets it to `unknown`.
- Track pong freshness separately from the existing any-data watchdog: only `system.pong` updates `lastPongTime`; any received message/frame updates `lastDataTime`, which remains the basis for the 25-second reconnect watchdog.
- Preserve the current 25-second no-data reconnect watchdog and four-second heartbeat cadence.

- [x] **Step 1: Add the host-health type and store field**

  Add the union and store action above; initialize health to `unknown`.

- [x] **Step 2: Update WebSocket lifecycle and heartbeat handling**

  Set `checking` on open and foreground resume; on foreground resume reset the pong timer before sending a ping. Set `responsive` only on `system.pong`, `stale` after 12 seconds without a pong, and `unknown` after close/disconnect. Keep watchdog timing based on received data unchanged.

- [x] **Step 3: Build the client**

  Run: `npm run build --prefix client`
  Expected: exit code 0.

### Task 2: Show actionable connection state and gate controls

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/features/status/FeatureAccessGate.tsx`
- Modify: `client/src/features/status/ConnectionStatusCard.tsx`

**Interfaces:**
- Consume the `hostHealth` store state from Task 1.
- Keep transport status and host health as separate concepts in labels and visual states.
- When connected and paired but not responsive, show a checking/stale explanation and a reconnect action. Only render interactive feature content when connected, authenticated, and responsive.
- Replace the hard-coded `v1.0 (LAN)` value with accurate host version/transport information from existing handshake data.

- [x] **Step 1: Update the header connection indicator**

  Show responsive only when `status === 'connected'` and `hostHealth === 'responsive'`; show checking/stale wording and appropriate color otherwise. Keep the existing reconnect action for disconnected state.

- [x] **Step 2: Update the feature access gate**

  Distinguish disconnected, connecting/reconnecting, unpaired, checking, and stale states. In checking/stale states, provide a reconnect button that calls `wsClient.reconnectImmediate()` and concise user-facing next steps.

- [x] **Step 3: Update the More connection card**

  Reflect both socket status and host health in its status badge and remove the misleading static protocol version.

- [x] **Step 4: Build the client**

  Run: `npm run build --prefix client`
  Expected: exit code 0.

### Task 3: Preserve unsent keyboard text and make retry explicit

**Files:**
- Modify: `client/src/App.tsx`
- Modify: `client/src/protocol/wsClient.ts`
- Modify: `client/src/features/keyboard/KeyboardControlBar.tsx`

**Interfaces:**
- Change `wsClient.send<T>(type, action, payload)` to return `true` only when `WebSocket.send` succeeds and `false` when the socket is unavailable or send throws.
- While `hostHealth !== 'responsive'`, return `false` without sending user control commands (`type === 'command'` except `auth.*`). Continue to allow heartbeat and auth handshake commands.
- Keep keyboard draft state in `App.tsx`, and pass it to `KeyboardControlBar` as controlled `textInput` and `onTextInputChange` props so it survives the access gate unmounting the keyboard during reconnect.
- Add an explicit retry action for a retained unsent draft; retry sends the text only and does not synthesize Enter.

- [x] **Step 1: Return local-send success from `wsClient.send`**

  Return `false` on unavailable socket, stale host, or send error and `true` after the local WebSocket send call succeeds. While health is not responsive, block non-auth command actions but continue allowing heartbeat and `auth.*`. This is local transport success only, not a server delivery acknowledgment.

- [x] **Step 2: Lift keyboard draft state to `App.tsx`**

  Make the keyboard input controlled by the App so the text value survives temporary feature-gate unmounts. Keep current typing, dictation, and IME composition behavior when responsive.

- [x] **Step 3: Retain and expose unsent text**

  When a pending text flush returns `false`, keep the draft visible and mark it unsent. After responsiveness returns, allow an explicit retry that sends only the draft. Clear the draft and unsent state only after `send` returns `true`.

- [x] **Step 4: Build the client and server**

  Run: `npm run build --prefix client`
  Run: `dotnet build server/RemoteAgent.sln`
  Expected: both commands exit with code 0.

---

## Execution Notes

- Do not add or run automated tests unless the user asks for testing. Build commands above are compile checks.
- Review the five Review Focus cases against the resulting state transitions before reporting completion.
- No server files are expected to change; the server build confirms the existing solution still compiles.

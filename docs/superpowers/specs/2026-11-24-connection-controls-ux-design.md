# Connection and Controls UX Design

## Intent

Make Remote Suite feel dependable while controlling a Windows PC from an iPhone. The first priority is to make the connection state truthful and actionable, then keep the touchpad and keyboard flows clear when the PC is slow or unreachable.

## Current behavior

- The app opens on the touchpad and attempts to connect automatically.
- The header marks the app connected when the WebSocket opens. The watchdog only reconnects after 25 seconds without server data, so a half-dead connection can look healthy and accept gestures that do not take effect.
- Feature access is gated by socket status and pairing, with no separate stale/unresponsive state.
- The connection card is under More and shows a hard-coded `v1.0 (LAN)` protocol label while the header shows app version `v1.3`.
- Touchpad and keyboard controls already exist; this work should preserve their gestures, pairing flow, and iPhone keyboard focus behavior.

## Goals

- Show whether the Windows host is responding, not only whether the socket is open.
- Give a clear recovery action when the socket is open but the host has stopped responding.
- Avoid silently dropping or misleadingly accepting touchpad, keyboard, screen, media, and power actions while the connection is stale.
- Keep the default startup flow, existing navigation, and visual style.
- Remove or correct connection copy that can be mistaken for the app or protocol version.

## Non-goals

- Full visual redesign or whole-app translation.
- Changes to the wire protocol, pairing/security model, or Windows input behavior.
- New dependencies or changes to how users install the Windows host.

## Approaches considered

1. **Visual copy and spacing only.** Lowest risk, but does not address the user's past experience of a green connected state with controls that do nothing.
2. **Connection trust and control-flow improvement (selected).** Track recent server responsiveness, reflect stale/recovering state in the UI, and gate remote actions with a clear reconnect path. Preserve the existing layout and interaction model. This targets the reliability issue with a contained client-side change.
3. **Full app redesign.** Could change every screen and navigation flow, but is larger and introduces unrelated regression risk before the core control feedback is dependable.

## Design

- Keep WebSocket transport state distinct from host responsiveness. Use heartbeat/pong freshness to identify a stale host and clear the stale state as soon as a valid response arrives.
- Account for iOS app suspension: on foreground resume, show a brief checking/reconnecting state rather than treating a suspended timer as proof the PC is offline.
- Present concise states in the header and the More connection card: connecting, connected and responsive, waiting for host, reconnecting, and disconnected. Give each non-ready state a plain-language next action.
- Gate remote-control features on both authorization and a responsive connection. Keep the active tab visible and show the reason plus a reconnect action instead of allowing gestures or text to appear to succeed.
- Retain the user's text in the keyboard field during a transient disconnect and show that it was not sent. Require an explicit retry after reconnection; do not automatically replay text because the current protocol has no delivery acknowledgment and replay could duplicate text.
- Replace the ambiguous hard-coded protocol label with accurate transport/host information already available from the handshake.
- Reuse existing connection store, heartbeat, and UI components; avoid a broad component rewrite.

## Constraints and builder calls

- Existing launch behavior and bottom navigation remain unchanged.
- No wire protocol changes or third-party packages.
- The host heartbeat interval is four seconds and the current watchdog threshold is 25 seconds. The implementation should choose and document a user-facing stale threshold that tolerates short iOS/network delays while reacting faster than the watchdog.
- Exact labels and colors should follow the current visual system and clearly distinguish transport-open from host-responsive.
- Keyboard retry behavior is a builder call: retain unsent input and require a deliberate resend, since the host may have received a command just before the connection dropped and the protocol cannot confirm delivery.

## Verification

- Build the client and server after implementation.
- Review the state transitions for startup, healthy connection, missed heartbeat, foreground resume, reconnection, disconnect, and unpaired device.
- Do not claim interactive behavior is verified unless it was observed on an iPhone and Windows host.

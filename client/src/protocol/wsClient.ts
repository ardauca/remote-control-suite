import { 
  MessageEnvelope, 
  ServerHelloPayload, 
  PongPayload, 
  VolumeStatePayload, 
  MediaNowPlayingPayload, 
  PowerStatusPayload, 
  ScreenTelemetryPayload,
  AuthResultPayload,
  ErrorPayload
} from './protocolTypes';
import { useConnectionStore } from '../stores/connectionStore';
import { useMediaStore } from '../stores/mediaStore';
import { usePowerStore } from '../stores/powerStore';
import { useScreenStore } from '../stores/screenStore';

type MessageHandler = (envelope: MessageEnvelope) => void;

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return [...bytes]
      .map((b, i) => (i === 4 || i === 6 || i === 8 || i === 10 ? '-' : '') + b.toString(16).padStart(2, '0'))
      .join('');
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

class WebSocketClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private binaryHandlers = new Set<(buffer: ArrayBuffer) => void>();
  private isManuallyClosed = false;

  private readonly MIN_RECONNECT_DELAY = 500;
  private readonly MAX_RECONNECT_DELAY = 3000;
  private readonly HEARTBEAT_INTERVAL = 4000;
  private readonly WATCHDOG_TIMEOUT = 25000;

  private lastPongTime = Date.now();

  constructor() {
    // Handle iOS Safari visibility change (instant reconnect on app resume)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!this.isConnected() && !this.isManuallyClosed) {
            useConnectionStore.getState().addLog('info', 'App resumed into foreground. Reconnecting...');
            this.reconnectImmediate();
          } else if (this.isConnected()) {
            // Proactively verify connection with instant ping instead of killing working socket
            this.send('heartbeat', 'system.ping', { clientTime: Date.now() });
          }
        }
      });

      window.addEventListener('online', () => {
        useConnectionStore.getState().addLog('info', 'Network connection restored.');
        this.reconnectImmediate();
      });
    }
  }

  public connect(targetUrl?: string) {
    this.isManuallyClosed = false;
    const url = targetUrl || useConnectionStore.getState().serverUrl;

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.cleanup();
    useConnectionStore.getState().setStatus('connecting');
    useConnectionStore.getState().addLog('info', `Connecting to ${url}...`);

    try {
      this.socket = new WebSocket(url);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = this.handleOpen.bind(this);
      this.socket.onmessage = this.handleMessage.bind(this);
      this.socket.onclose = this.handleClose.bind(this);
      this.socket.onerror = this.handleError.bind(this);
    } catch (err) {
      useConnectionStore.getState().addLog('error', `WebSocket creation failed: ${err}`);
      this.scheduleReconnect();
    }
  }

  public disconnect() {
    this.isManuallyClosed = true;
    this.cleanup();
    useConnectionStore.getState().setStatus('disconnected');
    useConnectionStore.getState().setServerInfo(null);
    useConnectionStore.getState().setLatency(0);
    useConnectionStore.getState().setAuthenticated(false);
    useConnectionStore.getState().addLog('info', 'Disconnected by user.');
  }

  public isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  public send<T>(type: 'command' | 'event' | 'response' | 'heartbeat', action: string, payload: T) {
    if (!this.isConnected()) {
      useConnectionStore.getState().addLog('warn', `Cannot send ${action}: Not connected`);
      return;
    }

    const envelope: MessageEnvelope<T> = {
      version: 1,
      id: generateUUID(),
      type,
      action,
      payload,
      timestamp: Date.now()
    };

    try {
      this.socket!.send(JSON.stringify(envelope));
    } catch (err) {
      useConnectionStore.getState().addLog('error', `Send error for ${action}: ${err}`);
    }
  }

  public pair(pin: string, deviceName?: string) {
    const cleanPin = pin.replace(/\D/g, '');
    const cleanName = deviceName || (typeof navigator !== 'undefined' && navigator.userAgent ? 'iPhone Safari' : 'Web Client');
    useConnectionStore.getState().addLog('info', `Sending pairing request for ${cleanName}...`);
    this.send('command', 'auth.pair', { pin: cleanPin, deviceName: cleanName });
  }

  public login(token: string) {
    if (!token) return;
    this.send('command', 'auth.login', { token });
  }

  public on(action: string, handler: MessageHandler) {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action)!.add(handler);
    return () => {
      this.handlers.get(action)?.delete(handler);
    };
  }

  public onBinary(handler: (buffer: ArrayBuffer) => void) {
    this.binaryHandlers.add(handler);
    return () => {
      this.binaryHandlers.delete(handler);
    };
  }

  private handleOpen() {
    const store = useConnectionStore.getState();
    store.setStatus('connected');
    store.resetReconnectAttempts();
    store.addLog('success', 'Connected to Windows Agent!');

    this.lastPongTime = Date.now();
    this.startHeartbeat();
  }

  private handleMessage(event: MessageEvent) {
    try {
      this.lastPongTime = Date.now(); // Any frame or message proves socket and server are alive!

      // Check for binary messages (e.g. Screen Mirroring JPEG frames)
      if (typeof event.data !== 'string') {
        const buffer = event.data as ArrayBuffer;
        this.binaryHandlers.forEach((handler) => handler(buffer));
        return;
      }

      const envelope = JSON.parse(event.data) as MessageEnvelope;
      const store = useConnectionStore.getState();

      // Built-in protocol actions
      if (envelope.action === 'system.hello') {
        const hello = envelope.payload as ServerHelloPayload;
        store.setServerInfo(hello);
        store.addLog('info', `Host identified: ${hello.serverName} (${hello.os})`);

        // If we have a saved auth token, authenticate automatically
        if (store.authToken) {
          store.addLog('info', 'Authenticating with saved session token...');
          this.login(store.authToken);
        } else {
          store.setAuthenticated(false);
        }
      } else if (envelope.action === 'auth.result') {
        const res = envelope.payload as AuthResultPayload;
        if (res.authenticated) {
          if (res.token) {
            store.setAuthToken(res.token);
          }
          store.setAuthenticated(true, res.capabilities, res.deviceId, res.deviceName);
          store.addLog('success', res.message || 'Device authenticated successfully!');
        } else {
          store.setAuthenticated(false);
          store.setAuthError(res.message);
          store.addLog('warn', res.message || 'Authentication failed. Please pair device.');
        }
      } else if (envelope.action === 'system.error') {
        const err = envelope.payload as ErrorPayload;
        if (err.code === 'UNAUTHORIZED') {
          store.setAuthenticated(false);
          store.setAuthError(err.message || 'Authentication required');
          store.addLog('error', `Security: ${err.message}`);
        } else if (err.code === 'RATE_LIMITED') {
          store.addLog('warn', `Rate limited: ${err.message}`);
        } else {
          store.addLog('warn', `Server error (${err.code}): ${err.message}`);
        }
      } else if (envelope.action === 'system.pong') {
        const pong = envelope.payload as PongPayload;
        const now = Date.now();
        this.lastPongTime = now;
        const rtt = Math.max(0, now - pong.clientTime);
        store.setLatency(rtt);
        store.setLastHeartbeat(now);
      } else if (envelope.action === 'volume.state') {
        const vol = envelope.payload as VolumeStatePayload;
        useMediaStore.getState().setVolumeState(vol);
      } else if (envelope.action === 'media.nowPlaying') {
        const media = envelope.payload as MediaNowPlayingPayload;
        useMediaStore.getState().setNowPlaying(media);
      } else if (envelope.action === 'power.status') {
        const power = envelope.payload as PowerStatusPayload;
        usePowerStore.getState().setPowerStatus(power);
      } else if (envelope.action === 'screen.telemetry') {
        const telemetry = envelope.payload as ScreenTelemetryPayload;
        useScreenStore.getState().setTelemetry(telemetry);
      }

      // Notify registered custom action listeners
      const listeners = this.handlers.get(envelope.action);
      if (listeners) {
        listeners.forEach((handler) => handler(envelope));
      }
    } catch (err) {
      useConnectionStore.getState().addLog('warn', `Failed to parse message: ${err}`);
    }
  }

  private handleClose(event: CloseEvent) {
    this.stopHeartbeat();
    const store = useConnectionStore.getState();
    store.setLatency(0);

    if (this.isManuallyClosed) {
      store.setStatus('disconnected');
    } else {
      store.addLog('warn', `WebSocket closed (code: ${event.code}, reason: ${event.reason || 'None'}). Scheduling reconnect...`);
      this.scheduleReconnect();
    }
  }

  private handleError(_event: Event) {
    useConnectionStore.getState().addLog('error', 'WebSocket network error occurred.');
    if (!this.isConnected() && !this.isManuallyClosed) {
      this.scheduleReconnect();
    }
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected()) {
        const timeSinceLastData = Date.now() - this.lastPongTime;
        if (timeSinceLastData > this.WATCHDOG_TIMEOUT) {
          useConnectionStore.getState().addLog('warn', `Heartbeat timeout: No data for ${(timeSinceLastData / 1000).toFixed(0)}s. Reconnecting...`);
          this.reconnectImmediate();
          return;
        }
        this.send('heartbeat', 'system.ping', { clientTime: Date.now() });
      }
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.isManuallyClosed) return;

    const store = useConnectionStore.getState();
    store.setStatus('reconnecting');
    store.incrementReconnectAttempts();

    const attempts = store.reconnectAttempts;
    // Fast reconnect for local Wi-Fi: 500ms, 650ms, 850ms, max 3000ms
    const delay = Math.min(
      this.MIN_RECONNECT_DELAY * Math.pow(1.3, Math.min(attempts, 6)),
      this.MAX_RECONNECT_DELAY
    );

    store.addLog('info', `Reconnecting in ${(delay / 1000).toFixed(1)}s (Attempt #${attempts})...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public reconnectImmediate() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
    this.connect();
  }

  private cleanup() {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.onopen = null;
      this.socket.onmessage = null;
      this.socket.onclose = null;
      this.socket.onerror = null;
      try {
        this.socket.close();
      } catch {
        // ignore
      }
      this.socket = null;
    }
  }
}

export const wsClient = new WebSocketClient();

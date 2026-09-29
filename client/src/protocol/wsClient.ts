import { MessageEnvelope, ServerHelloPayload, PongPayload } from './protocolTypes';
import { useConnectionStore } from '../stores/connectionStore';

type MessageHandler = (envelope: MessageEnvelope) => void;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectTimer: number | null = null;
  private handlers = new Map<string, Set<MessageHandler>>();
  private isManuallyClosed = false;

  private readonly MIN_RECONNECT_DELAY = 1000;
  private readonly MAX_RECONNECT_DELAY = 10000;
  private readonly HEARTBEAT_INTERVAL = 3000;

  constructor() {
    // Handle iOS Safari visibility change (instant reconnect on app resume)
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!this.isConnected() && !this.isManuallyClosed) {
            useConnectionStore.getState().addLog('info', 'App resumed into foreground. Reconnecting...');
            this.reconnectImmediate();
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
      id: Math.random().toString(36).substring(2, 11),
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

  public on(action: string, handler: MessageHandler) {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action)!.add(handler);
    return () => {
      this.handlers.get(action)?.delete(handler);
    };
  }

  private handleOpen() {
    const store = useConnectionStore.getState();
    store.setStatus('connected');
    store.resetReconnectAttempts();
    store.addLog('success', 'Connected to Windows Agent!');

    this.startHeartbeat();
  }

  private handleMessage(event: MessageEvent) {
    try {
      const envelope = JSON.parse(event.data) as MessageEnvelope;

      // Built-in protocol actions
      if (envelope.action === 'system.hello') {
        const hello = envelope.payload as ServerHelloPayload;
        useConnectionStore.getState().setServerInfo(hello);
        useConnectionStore.getState().addLog('info', `Host identified: ${hello.serverName} (${hello.os})`);
      } else if (envelope.action === 'system.pong') {
        const pong = envelope.payload as PongPayload;
        const now = Date.now();
        const rtt = Math.max(0, now - pong.clientTime);
        useConnectionStore.getState().setLatency(rtt);
        useConnectionStore.getState().setLastHeartbeat(now);
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
    useConnectionStore.getState().setStatus('disconnected');
    useConnectionStore.getState().addLog('warn', `Connection closed (Code: ${event.code})`);
    this.cleanup();

    if (!this.isManuallyClosed) {
      this.scheduleReconnect();
    }
  }

  private handleError(_event: Event) {
    useConnectionStore.getState().addLog('error', 'WebSocket network error occurred.');
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.isConnected()) {
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
    // Exponential backoff with jitter: min(1000 * 1.5^(attempts), 10000)
    const delay = Math.min(
      this.MIN_RECONNECT_DELAY * Math.pow(1.5, Math.min(attempts, 8)),
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
        // Ignore
      }
      this.socket = null;
    }
  }
}

export const wsClient = new WebSocketClient();

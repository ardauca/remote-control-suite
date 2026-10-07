import { create } from 'zustand';
import { ConnectionStatus, ServerHelloPayload } from '../protocol/protocolTypes';

export interface LogEntry {
  id: string;
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

interface ConnectionState {
  status: ConnectionStatus;
  serverUrl: string;
  latency: number | null;
  serverInfo: ServerHelloPayload | null;
  lastHeartbeat: number | null;
  reconnectAttempts: number;
  logs: LogEntry[];

  // Authentication & Pairing State
  authToken: string;
  isAuthenticated: boolean;
  deviceId: string | null;
  deviceName: string | null;
  capabilities: string[];
  authError: string | null;

  // Actions
  setStatus: (status: ConnectionStatus) => void;
  setServerUrl: (url: string) => void;
  setLatency: (latency: number) => void;
  setServerInfo: (info: ServerHelloPayload | null) => void;
  setLastHeartbeat: (timestamp: number) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
  addLog: (level: LogEntry['level'], message: string) => void;
  clearLogs: () => void;

  setAuthToken: (token: string | null) => void;
  setAuthenticated: (isAuth: boolean, caps?: string[], deviceId?: string, deviceName?: string) => void;
  setAuthError: (err: string | null) => void;
  clearAuth: () => void;
}

// Compute default WS URL from current browser URL
const getDefaultServerUrl = (): string => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.hostname || 'localhost';
  const port = window.location.port === '3000' ? '52520' : (window.location.port || '52520');
  return `${protocol}//${host}:${port}/ws`;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'disconnected',
  serverUrl: localStorage.getItem('remote_suite_ws_url') || getDefaultServerUrl(),
  latency: null,
  serverInfo: null,
  lastHeartbeat: null,
  reconnectAttempts: 0,
  logs: [],

  authToken: localStorage.getItem('remote_suite_auth_token') || '',
  isAuthenticated: false,
  deviceId: null,
  deviceName: null,
  capabilities: [],
  authError: null,

  setStatus: (status) => set({ status }),
  setServerUrl: (url) => {
    localStorage.setItem('remote_suite_ws_url', url);
    set({ serverUrl: url });
  },
  setLatency: (latency) => set({ latency }),
  setServerInfo: (serverInfo) => set({ serverInfo }),
  setLastHeartbeat: (lastHeartbeat) => set({ lastHeartbeat }),
  incrementReconnectAttempts: () => set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 })),
  resetReconnectAttempts: () => set({ reconnectAttempts: 0 }),
  addLog: (level, message) => set((state) => {
    const entry: LogEntry = {
      id: crypto.randomUUID ? crypto.randomUUID().substring(0, 8) : Math.random().toString(36).substring(2, 9),
      time: new Date().toLocaleTimeString(),
      level,
      message
    };
    return {
      logs: [entry, ...state.logs].slice(0, 50)
    };
  }),
  clearLogs: () => set({ logs: [] }),

  setAuthToken: (token) => {
    if (token) {
      localStorage.setItem('remote_suite_auth_token', token);
      set({ authToken: token });
    } else {
      localStorage.removeItem('remote_suite_auth_token');
      set({ authToken: '', isAuthenticated: false, deviceId: null, capabilities: [] });
    }
  },

  setAuthenticated: (isAuth, caps, deviceId, deviceName) => {
    set((state) => ({
      isAuthenticated: isAuth,
      capabilities: caps || [],
      deviceId: deviceId || null,
      deviceName: deviceName || null,
      authError: isAuth ? null : state.authError
    }));
  },

  setAuthError: (err) => set({ authError: err }),

  clearAuth: () => {
    localStorage.removeItem('remote_suite_auth_token');
    set({
      authToken: '',
      isAuthenticated: false,
      deviceId: null,
      deviceName: null,
      capabilities: [],
      authError: null
    });
  }
}));

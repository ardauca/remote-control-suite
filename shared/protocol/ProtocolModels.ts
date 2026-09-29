/**
 * Remote Control Suite - Shared Protocol Models (v1)
 */

export interface MessageEnvelope<T = unknown> {
  version: 1;
  id: string;
  type: 'command' | 'event' | 'response' | 'heartbeat';
  action: string;
  payload: T;
  timestamp: number;
}

export interface PingPayload {
  clientTime: number;
}

export interface PongPayload {
  clientTime: number;
  serverTime: number;
}

export interface ServerHelloPayload {
  serverName: string;
  version: string;
  os: string;
  capabilities: string[];
}

export interface ErrorPayload {
  code: string;
  message: string;
  originalAction?: string;
}

// Mouse Payloads (Phase 3)
export interface MouseMovePayload {
  dx: number;
  dy: number;
}

export interface MouseClickPayload {
  button: 'left' | 'right' | 'middle';
  double?: boolean;
}

export interface MouseScrollPayload {
  dx: number;
  dy: number;
}

// Keyboard Payloads (Phase 4)
export interface KeyboardTextPayload {
  text: string;
}

export interface KeyboardKeyPayload {
  key: string;
}

export interface KeyboardShortcutPayload {
  keys: string[];
}

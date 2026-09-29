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

// Mouse Payloads
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

// Keyboard Payloads
export interface KeyboardTextPayload {
  text: string;
}

export interface KeyboardKeyPayload {
  key: string;
}

export interface KeyboardShortcutPayload {
  keys: string[];
}

// Media & Volume Payloads (Phase 5)
export interface VolumeSetMasterPayload {
  volume: number; // 0 - 100
  mute?: boolean;
}

export interface VolumeSetSessionPayload {
  sessionId: string;
  volume: number; // 0 - 100
  mute?: boolean;
}

export interface AudioSessionItem {
  id: string;
  name: string;
  processId: number;
  volume: number; // 0 - 100
  isMuted: boolean;
}

export interface VolumeStatePayload {
  masterVolume: number; // 0 - 100
  isMuted: boolean;
  sessions: AudioSessionItem[];
}

export interface MediaActionPayload {
  action: 'play' | 'pause' | 'playPause' | 'next' | 'previous' | 'stop';
}

export interface MediaNowPlayingPayload {
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  sourceApp?: string;
}

// Power & System Controls (Phase 6)
export type PowerActionType = 
  | 'lock' 
  | 'sleep' 
  | 'displayOff' 
  | 'taskManager' 
  | 'showDesktop' 
  | 'taskView' 
  | 'screenshot'
  | 'shutdown' 
  | 'restart';

export interface PowerActionPayload {
  action: PowerActionType;
}

export interface PowerSchedulePayload {
  action: 'shutdown' | 'restart';
  timeoutSeconds: number;
}

export interface PowerStatusPayload {
  isActive: boolean;
  action: 'shutdown' | 'restart' | 'none';
  totalSeconds: number;
  remainingSeconds: number;
  targetTimeUtc?: string;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

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

// Auth & Security
export interface AuthPairPayload {
  pin: string;
  deviceName?: string;
}

export interface AuthLoginPayload {
  token: string;
}

export interface AuthResultPayload {
  authenticated: boolean;
  token?: string;
  deviceId?: string;
  deviceName?: string;
  capabilities?: string[];
  message: string;
}

export interface AuthStatusPayload {
  authenticated: boolean;
  deviceId?: string;
  deviceName?: string;
  capabilities?: string[];
}

// Screen Mirroring & Stream (Phase 7)
export interface ScreenStartPayload {
  fps: number;
  quality: number;
  scale: number;
  monitorIndex: number;
}

export interface ScreenTouchPayload {
  normX: number;
  normY: number;
  type: 'click' | 'double' | 'right' | 'down' | 'up' | 'move';
  button?: 'left' | 'right' | 'middle';
}

export interface ScreenTelemetryPayload {
  actualFps: number;
  droppedFrames: number;
  bytesPerSecond: number;
  estimatedMbPerMinute: number;
  estimatedGbPerHour: number;
  queueDepth: number;
  captureDurationMs: number;
  encodeDurationMs?: number;
  sendDurationMs: number;
}

export interface ScreenMonitorInfo {
  index: number;
  deviceName: string;
  width: number;
  height: number;
  isPrimary: boolean;
}

export interface DecodedBinaryFrame {
  sequenceNumber: number;
  desktopWidth: number;
  desktopHeight: number;
  normCursorX: number; // 0.0 - 1.0
  normCursorY: number; // 0.0 - 1.0
  cursorVisible: boolean;
  imageBlob: Blob;
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

import { create } from 'zustand';
import { wsClient } from '../protocol/wsClient';
import { ScreenStartPayload, ScreenTelemetryPayload, ScreenTouchPayload } from '../protocol/protocolTypes';

export type ScreenPreset = 'mobile' | 'balanced' | 'high' | 'snapshot';

interface ScreenState {
  isStreaming: boolean;
  activePreset: ScreenPreset;
  fps: number;
  quality: number;
  scale: number;
  monitorIndex: number;
  telemetry: ScreenTelemetryPayload | null;
  zoom: number;
  panOffset: { x: number; y: number };

  startStream: (config?: Partial<ScreenStartPayload>) => void;
  stopStream: () => void;
  requestSnapshot: () => void;
  sendTouch: (normX: number, normY: number, type: ScreenTouchPayload['type'], button?: ScreenTouchPayload['button']) => void;
  setPreset: (preset: ScreenPreset) => void;
  setZoom: (zoom: number) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  setTelemetry: (telemetry: ScreenTelemetryPayload) => void;
}

export const useScreenStore = create<ScreenState>((set, get) => ({
  isStreaming: false,
  activePreset: 'balanced',
  fps: 15,
  quality: 65,
  scale: 0.75,
  monitorIndex: 0,
  telemetry: null,
  zoom: 1.0,
  panOffset: { x: 0, y: 0 },

  startStream: (customConfig) => {
    const { fps, quality, scale, monitorIndex } = get();
    const config: ScreenStartPayload = {
      fps: customConfig?.fps ?? fps,
      quality: customConfig?.quality ?? quality,
      scale: customConfig?.scale ?? scale,
      monitorIndex: customConfig?.monitorIndex ?? monitorIndex
    };

    set({ isStreaming: true, ...config });
    wsClient.send('command', 'screen.start', config);
  },

  stopStream: () => {
    set({ isStreaming: false });
    wsClient.send('command', 'screen.stop', {});
  },

  requestSnapshot: () => {
    const { monitorIndex, scale, quality } = get();
    wsClient.send('command', 'screen.snapshot', { monitorIndex, scale, quality: Math.max(quality, 80) });
  },

  sendTouch: (normX, normY, type, button = 'left') => {
    wsClient.send('command', 'screen.touch', {
      normX: Math.max(0, Math.min(1, normX)),
      normY: Math.max(0, Math.min(1, normY)),
      type,
      button
    });
  },

  setPreset: (preset) => {
    let fps = 15;
    let quality = 65;
    let scale = 0.75;

    switch (preset) {
      case 'mobile':
        fps = 8;
        quality = 45;
        scale = 0.55;
        break;
      case 'balanced':
        fps = 15;
        quality = 65;
        scale = 0.75;
        break;
      case 'high':
        fps = 25;
        quality = 80;
        scale = 1.0;
        break;
      case 'snapshot':
        fps = 0;
        quality = 85;
        scale = 1.0;
        break;
    }

    set({ activePreset: preset, fps, quality, scale });

    if (get().isStreaming && preset !== 'snapshot') {
      get().startStream({ fps, quality, scale });
    } else if (preset === 'snapshot') {
      get().stopStream();
      get().requestSnapshot();
    }
  },

  setZoom: (zoom) => set({ zoom: Math.max(1.0, Math.min(4.0, zoom)) }),
  setPanOffset: (panOffset) => set({ panOffset }),
  setTelemetry: (telemetry) => set({ telemetry })
}));

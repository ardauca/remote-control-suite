import { create } from 'zustand';
import { wsClient } from '../protocol/wsClient';
import { PowerActionType, PowerStatusPayload } from '../protocol/protocolTypes';

interface PowerState {
  powerStatus: PowerStatusPayload | null;
  setPowerStatus: (status: PowerStatusPayload) => void;
  executePowerAction: (action: PowerActionType) => void;
  scheduleShutdown: (timeoutSeconds: number, action?: 'shutdown' | 'restart') => void;
  cancelScheduledShutdown: () => void;
  requestPowerStatus: () => void;
}

export const usePowerStore = create<PowerState>((set) => ({
  powerStatus: null,

  setPowerStatus: (powerStatus) => set({ powerStatus }),

  executePowerAction: (action) => {
    wsClient.send('command', 'power.action', { action });
  },

  scheduleShutdown: (timeoutSeconds, action = 'shutdown') => {
    wsClient.send('command', 'power.schedule', { action, timeoutSeconds });
  },

  cancelScheduledShutdown: () => {
    wsClient.send('command', 'power.cancel', {});
  },

  requestPowerStatus: () => {
    wsClient.send('command', 'power.requestStatus', {});
  }
}));

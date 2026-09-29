import { create } from 'zustand';
import { wsClient } from '../protocol/wsClient';
import { VolumeStatePayload, MediaNowPlayingPayload } from '../protocol/protocolTypes';

interface MediaState {
  volumeState: VolumeStatePayload | null;
  nowPlaying: MediaNowPlayingPayload | null;

  setVolumeState: (state: VolumeStatePayload) => void;
  setNowPlaying: (meta: MediaNowPlayingPayload) => void;

  setMasterVolume: (volume: number, mute?: boolean) => void;
  toggleMasterMute: () => void;
  setSessionVolume: (sessionId: string, volume: number, mute?: boolean) => void;
  toggleSessionMute: (sessionId: string) => void;
  executeMediaAction: (action: 'play' | 'pause' | 'playPause' | 'next' | 'previous' | 'stop') => void;
}

export const useMediaStore = create<MediaState>((set, get) => ({
  volumeState: null,
  nowPlaying: null,

  setVolumeState: (volumeState) => set({ volumeState }),
  setNowPlaying: (nowPlaying) => set({ nowPlaying }),

  setMasterVolume: (volume, mute) => {
    const current = get().volumeState;
    if (current) {
      set({
        volumeState: {
          ...current,
          masterVolume: volume,
          isMuted: mute !== undefined ? mute : current.isMuted
        }
      });
    }
    wsClient.send('command', 'volume.setMaster', { volume, mute });
  },

  toggleMasterMute: () => {
    const current = get().volumeState;
    if (!current) return;
    const nextMute = !current.isMuted;
    set({
      volumeState: {
        ...current,
        isMuted: nextMute
      }
    });
    wsClient.send('command', 'volume.setMaster', { volume: current.masterVolume, mute: nextMute });
  },

  setSessionVolume: (sessionId, volume, mute) => {
    const current = get().volumeState;
    if (current) {
      const updatedSessions = current.sessions.map((s) => {
        if (s.id === sessionId) {
          return {
            ...s,
            volume,
            isMuted: mute !== undefined ? mute : s.isMuted
          };
        }
        return s;
      });
      set({
        volumeState: {
          ...current,
          sessions: updatedSessions
        }
      });
    }
    wsClient.send('command', 'volume.setSession', { sessionId, volume, mute });
  },

  toggleSessionMute: (sessionId) => {
    const current = get().volumeState;
    if (!current) return;
    const session = current.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const nextMute = !session.isMuted;
    get().setSessionVolume(sessionId, session.volume, nextMute);
  },

  executeMediaAction: (action) => {
    // Optimistic toggle
    const nowPlaying = get().nowPlaying;
    if (nowPlaying && (action === 'play' || action === 'pause' || action === 'playPause')) {
      const nextPlaying = action === 'play' ? true : action === 'pause' ? false : !nowPlaying.isPlaying;
      set({ nowPlaying: { ...nowPlaying, isPlaying: nextPlaying } });
    }
    wsClient.send('command', 'media.action', { action });
  }
}));

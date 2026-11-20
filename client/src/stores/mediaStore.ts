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
    const shouldUnmute = current?.isMuted && volume > 0;
    const effectiveMute = mute !== undefined ? mute : (shouldUnmute ? false : current?.isMuted ?? false);

    set({
      volumeState: {
        masterVolume: volume,
        isMuted: effectiveMute,
        sessions: current?.sessions ?? []
      }
    });

    const payload: { volume: number; mute?: boolean } = { volume };
    if (mute !== undefined || shouldUnmute) {
      payload.mute = effectiveMute;
    }
    wsClient.send('command', 'volume.setMaster', payload);
  },

  toggleMasterMute: () => {
    const current = get().volumeState;
    const currentVol = current ? current.masterVolume : 50;
    const nextMute = current ? !current.isMuted : true;
    set({
      volumeState: {
        masterVolume: currentVol,
        isMuted: nextMute,
        sessions: current ? current.sessions : []
      }
    });
    wsClient.send('command', 'volume.setMaster', { volume: currentVol, mute: nextMute });
  },

  setSessionVolume: (sessionId, volume, mute) => {
    const current = get().volumeState;
    const currentSession = current?.sessions.find((session) => session.id === sessionId);
    const shouldUnmute = currentSession?.isMuted === true && volume > 0;
    if (current) {
      const updatedSessions = current.sessions.map((s) => {
        if (s.id === sessionId) {
          const shouldUnmute = s.isMuted && volume > 0;
          const effectiveMute = mute !== undefined ? mute : (shouldUnmute ? false : s.isMuted);
          return {
            ...s,
            volume,
            isMuted: effectiveMute
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
    const payload: { sessionId: string; volume: number; mute?: boolean } = { sessionId, volume };
    if (mute !== undefined || shouldUnmute) {
      payload.mute = mute ?? false;
    }
    wsClient.send('command', 'volume.setSession', payload);
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

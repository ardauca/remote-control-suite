import React, { useEffect, useState } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { wsClient } from '../../protocol/wsClient';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  Square, 
  Volume2, 
  VolumeX, 
  Volume1, 
  Music, 
  Sliders, 
  RefreshCw,
  AppWindow,
  Globe,
  FileText,
  Calculator,
  Folder,
  Activity,
  Terminal,
  MessageSquare,
  Sparkles,
  Check
} from 'lucide-react';

export const MediaControlView: React.FC = () => {
  const { 
    volumeState, 
    nowPlaying, 
    setMasterVolume, 
    toggleMasterMute, 
    setSessionVolume, 
    toggleSessionMute, 
    executeMediaAction 
  } = useMediaStore();

  const [launchedApp, setLaunchedApp] = useState<string | null>(null);

  // Poll / request state on mount
  useEffect(() => {
    wsClient.send('command', 'volume.requestState', {});
    wsClient.send('command', 'media.requestNowPlaying', {});
  }, []);

  const masterVol = volumeState?.masterVolume ?? 50;
  const isMuted = volumeState?.isMuted ?? false;
  const sessions = volumeState?.sessions ?? [];

  const handleMasterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setMasterVolume(val);
    if ('vibrate' in navigator) {
      navigator.vibrate(5);
    }
  };

  const handlePresetClick = (val: number) => {
    setMasterVolume(val, val === 0);
    if ('vibrate' in navigator) {
      navigator.vibrate(10);
    }
  };

  const refreshState = () => {
    wsClient.send('command', 'volume.requestState', {});
    wsClient.send('command', 'media.requestNowPlaying', {});
    if ('vibrate' in navigator) {
      navigator.vibrate(15);
    }
  };

  const handleLaunchApp = (appId: string, appName: string) => {
    if ('vibrate' in navigator) navigator.vibrate(15);
    wsClient.send('command', 'system.launchApp', { app: appId });
    setLaunchedApp(appName);
    window.setTimeout(() => {
      setLaunchedApp(null);
    }, 2500);
  };

  return (
    <div className="w-full space-y-4 select-none animate-fadeIn pb-16">
      {/* 1. Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Music className="w-5 h-5 text-brand-400" />
              Media & Sound Mixer
            </h2>
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-brand-500/20 text-brand-400 rounded-md border border-brand-500/30">
              v2.0
            </span>
          </div>
          <p className="text-xs text-slate-400">Control Windows master sound, app volumes, and media</p>
        </div>
        <button
          onClick={refreshState}
          title="Refresh audio state"
          className="p-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-400 hover:text-white border border-slate-700 active:scale-95 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Now Playing Glassmorphic Card */}
      <div className="relative shrink-0 overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-800/80 to-dark-900/90 border border-slate-700/60 p-5 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-4">
          {/* Album Art / Icon */}
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-brand-500/20 flex-shrink-0">
            <Music className="w-8 h-8 text-white animate-pulse" />
          </div>

          {/* Track Info */}
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase font-bold tracking-wider text-brand-400 mb-0.5 truncate">
              {nowPlaying?.sourceApp ? nowPlaying.sourceApp : 'Windows Media'}
            </div>
            <h3 className="text-base font-bold text-white truncate leading-tight">
              {nowPlaying?.title || 'No active media playing'}
            </h3>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              {nowPlaying?.artist || (nowPlaying?.title ? 'Unknown Artist' : 'Play a track in Spotify, YouTube or Browser')}
            </p>
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-around gap-2 mt-5 pt-3 border-t border-slate-700/40">
          {/* Previous Track Button */}
          <button
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate(10);
              executeMediaAction('previous');
            }}
            className="flex-1 max-w-[84px] h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 active:scale-95 text-slate-100 flex flex-col items-center justify-center gap-1 border-2 border-slate-600/80 shadow-md transition-all select-none"
            title="Previous Track (|<<)"
            aria-label="Previous Track"
          >
            <SkipBack className="w-6 h-6 text-brand-300" />
            <span className="text-[11px] font-bold tracking-wide">|&lt;&lt; Prev</span>
          </button>

          {/* Play / Pause Main Hero Button */}
          <button
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate(15);
              executeMediaAction('playPause');
            }}
            className="flex-1 max-w-[110px] h-16 rounded-2xl bg-gradient-to-r from-brand-500 via-indigo-500 to-brand-600 hover:brightness-110 active:scale-95 text-white flex flex-col items-center justify-center gap-1 border-2 border-brand-300/40 shadow-xl shadow-brand-500/30 transition-all select-none"
            title={nowPlaying?.isPlaying ? 'Pause' : 'Play'}
            aria-label={nowPlaying?.isPlaying ? 'Pause' : 'Play'}
          >
            {nowPlaying?.isPlaying ? (
              <>
                <Pause className="w-7 h-7 fill-current" />
                <span className="text-[11px] font-extrabold uppercase tracking-wider">Pause</span>
              </>
            ) : (
              <>
                <Play className="w-7 h-7 fill-current ml-0.5" />
                <span className="text-[11px] font-extrabold uppercase tracking-wider">Play</span>
              </>
            )}
          </button>

          {/* Next Track Button */}
          <button
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate(10);
              executeMediaAction('next');
            }}
            className="flex-1 max-w-[84px] h-16 rounded-2xl bg-slate-800 hover:bg-slate-700 active:bg-slate-600 active:scale-95 text-slate-100 flex flex-col items-center justify-center gap-1 border-2 border-slate-600/80 shadow-md transition-all select-none"
            title="Next Track (>>|)"
            aria-label="Next Track"
          >
            <SkipForward className="w-6 h-6 text-brand-300" />
            <span className="text-[11px] font-bold tracking-wide">Next &gt;&gt;|</span>
          </button>

          {/* Stop Button */}
          <button
            onClick={() => {
              if ('vibrate' in navigator) navigator.vibrate(10);
              executeMediaAction('stop');
            }}
            className="w-14 h-16 rounded-2xl bg-slate-900/90 hover:bg-slate-800 active:bg-rose-950/40 active:scale-95 text-slate-400 hover:text-rose-400 flex flex-col items-center justify-center gap-1 border border-slate-700/80 transition-all select-none"
            title="Stop"
            aria-label="Stop"
          >
            <Square className="w-5 h-5" />
            <span className="text-[10px] font-medium">Stop</span>
          </button>
        </div>
      </div>

      {/* 3. Quick App Launcher (Hızlı Program Başlatıcı) */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-4 border border-slate-700/60 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Hızlı Program Başlatıcı
          </div>
          {launchedApp && (
            <span className="text-[11px] font-medium text-emerald-400 animate-fadeIn flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              {launchedApp} açılıyor...
            </span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2">
          {[
            { id: 'chrome', name: 'Chrome', icon: Globe, color: 'text-amber-400 hover:border-amber-500/50' },
            { id: 'ytmusic', name: 'YT Music', icon: Music, color: 'text-rose-400 hover:border-rose-500/50' },
            { id: 'notepad', name: 'Not Defteri', icon: FileText, color: 'text-sky-400 hover:border-sky-500/50' },
            { id: 'calc', name: 'Hesap Mak.', icon: Calculator, color: 'text-purple-400 hover:border-purple-500/50' },
            { id: 'explorer', name: 'Dosyalar', icon: Folder, color: 'text-yellow-400 hover:border-yellow-500/50' },
            { id: 'taskmanager', name: 'Görev Yön.', icon: Activity, color: 'text-rose-400 hover:border-rose-500/50' },
            { id: 'terminal', name: 'Terminal', icon: Terminal, color: 'text-slate-200 hover:border-slate-500/50' },
            { id: 'discord', name: 'Discord', icon: MessageSquare, color: 'text-indigo-400 hover:border-indigo-500/50' },
          ].map((app) => {
            const Icon = app.icon;
            return (
              <button
                key={app.id}
                onClick={() => handleLaunchApp(app.id, app.name)}
                className={`h-16 rounded-2xl bg-dark-900 border border-slate-700/80 flex flex-col items-center justify-center gap-1 transition-all active:scale-90 shadow-md ${app.color}`}
                title={`${app.name} Başlat`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold text-slate-300 truncate max-w-[90%]">{app.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Master Volume Card */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <button
              onClick={toggleMasterMute}
              className={`p-2.5 rounded-2xl border transition-all ${
                isMuted
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                  : 'bg-brand-500/20 text-brand-300 border-brand-500/40'
              }`}
            >
              {isMuted ? <VolumeX className="w-5 h-5" /> : masterVol < 30 ? <Volume1 className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            <div>
              <div className="text-xs font-semibold text-slate-400">Master Volume</div>
              <div className="text-lg font-bold text-white font-mono">
                {isMuted ? 'MUTED' : `${Math.round(masterVol)}%`}
              </div>
            </div>
          </div>

          {/* Quick Presets */}
          <div className="flex items-center gap-1.5">
            {[0, 25, 50, 75, 100].map((preset) => (
              <button
                key={preset}
                onClick={() => handlePresetClick(preset)}
                className={`px-2 py-1 rounded-xl text-[10px] font-bold border transition-colors ${
                  !isMuted && Math.round(masterVol) === preset
                    ? 'bg-brand-500 text-white border-brand-400'
                    : 'bg-dark-900 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                {preset === 0 ? 'Mute' : `${preset}%`}
              </button>
            ))}
          </div>
        </div>

        {/* Master Slider */}
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          value={isMuted ? 0 : masterVol}
          onChange={handleMasterChange}
          className="w-full h-3 bg-dark-900 rounded-lg appearance-none cursor-pointer accent-brand-500"
        />
      </div>

      {/* 4. Windows Volume Mixer (App Sessions) */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-300 uppercase tracking-wider">
            <Sliders className="w-4 h-4 text-emerald-400" />
            Active Application Mixer
          </div>
          <span className="text-[10px] text-slate-500 font-mono">
            {sessions.length} active app(s)
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500">
            No running applications currently emitting audio.
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="bg-dark-900/80 rounded-2xl p-3 border border-slate-700/50 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <AppWindow className="w-4 h-4 text-slate-400 flex-shrink-0" />
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {session.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-slate-400">
                      {session.isMuted ? 'Muted' : `${Math.round(session.volume)}%`}
                    </span>
                    <button
                      onClick={() => toggleSessionMute(session.id)}
                      className={`p-1.5 rounded-lg border text-xs transition-colors ${
                        session.isMuted
                          ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                          : 'bg-dark-800 text-slate-400 border-slate-700 hover:text-white'
                      }`}
                    >
                      {session.isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  value={session.isMuted ? 0 : session.volume}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setSessionVolume(session.id, val);
                  }}
                  className="w-full h-2 bg-dark-800 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useState, useEffect } from 'react';
import { usePowerStore } from '../../stores/powerStore';
import { 
  Power, 
  Moon, 
  Lock, 
  Monitor, 
  RotateCcw, 
  Clock, 
  AlertTriangle, 
  Activity, 
  Layout, 
  Layers, 
  Camera, 
  RefreshCw 
} from 'lucide-react';

export const PowerSystemView: React.FC = () => {
  const { 
    powerStatus, 
    executePowerAction, 
    scheduleShutdown, 
    cancelScheduledShutdown, 
    requestPowerStatus 
  } = usePowerStore();

  const [customMinutes, setCustomMinutes] = useState<number>(30);
  const [targetAction, setTargetAction] = useState<'shutdown' | 'restart'>('shutdown');
  
  // Safety confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    action: 'shutdown' | 'restart' | null;
    title: string;
    description: string;
  }>({
    isOpen: false,
    action: null,
    title: '',
    description: ''
  });

  useEffect(() => {
    requestPowerStatus();
  }, [requestPowerStatus]);

  const vibrate = (ms = 10) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(ms);
    }
  };

  const handleInstantAction = (action: 'lock' | 'sleep' | 'displayOff' | 'taskManager' | 'showDesktop' | 'taskView' | 'screenshot') => {
    vibrate(10);
    executePowerAction(action);
  };

  const promptDangerousAction = (action: 'shutdown' | 'restart') => {
    vibrate(15);
    if (action === 'shutdown') {
      setConfirmDialog({
        isOpen: true,
        action: 'shutdown',
        title: 'Bilgisayarı Kapat',
        description: 'Bilgisayarınız hemen tamamen kapatılacak. Kaydedilmemiş çalışmalarınız kaybolabilir. Emin misiniz?'
      });
    } else {
      setConfirmDialog({
        isOpen: true,
        action: 'restart',
        title: 'Yeniden Başlat',
        description: 'Bilgisayarınız hemen yeniden başlatılacak. Emin misiniz?'
      });
    }
  };

  const confirmDangerousAction = () => {
    vibrate(25);
    if (confirmDialog.action) {
      executePowerAction(confirmDialog.action);
    }
    setConfirmDialog({ isOpen: false, action: null, title: '', description: '' });
  };

  const handleSchedulePreset = (minutes: number) => {
    vibrate(15);
    scheduleShutdown(minutes * 60, targetAction);
  };

  const handleCustomSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    if (customMinutes > 0) {
      vibrate(15);
      scheduleShutdown(customMinutes * 60, targetAction);
    }
  };

  // Format seconds into HH:MM:SS
  const formatCountdown = (totalSec: number) => {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;
    
    if (hours > 0) {
      return `${hours}s ${minutes.toString().padStart(2, '0')}dk ${seconds.toString().padStart(2, '0')}sn`;
    }
    return `${minutes}dk ${seconds.toString().padStart(2, '0')}sn`;
  };

  const isTimerActive = powerStatus?.isActive && (powerStatus?.remainingSeconds ?? 0) > 0;

  return (
    <div className="w-full space-y-4 select-none animate-fadeIn pb-24">
      {/* 1. Header with Refresh */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Power className="w-5 h-5 text-rose-400" />
              Sistem & Güç Yönetimi
            </h2>
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-400 rounded-md border border-rose-500/30">
              v2.0
            </span>
          </div>
          <p className="text-xs text-slate-400">Güç seçenekleri, uyku modu ve zamanlı kapatıcı</p>
        </div>
        <button
          onClick={() => {
            vibrate(10);
            requestPowerStatus();
          }}
          title="Yenile"
          className="p-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-400 hover:text-white border border-slate-700 active:scale-95 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Active Scheduled Shutdown Banner (If Running) */}
      {isTimerActive && (
        <div className="shrink-0 relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-950/80 via-dark-800/90 to-dark-900/95 border-2 border-amber-500/50 p-5 shadow-2xl backdrop-blur-xl animate-pulse">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <Clock className="w-6 h-6 text-amber-400 animate-spin" style={{ animationDuration: '4s' }} />
              </div>
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">
                  {powerStatus.action === 'restart' ? 'Zamanlı Yeniden Başlatma Aktif' : 'Zamanlı Kapanma Aktif'}
                </span>
                <div className="text-2xl font-black font-mono text-white tracking-tight">
                  {formatCountdown(powerStatus.remainingSeconds)}
                </div>
              </div>
            </div>

            <button
              onClick={() => {
                vibrate(20);
                cancelScheduledShutdown();
              }}
              className="px-3.5 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 active:scale-95 text-xs font-bold transition-all"
            >
              İptal Et
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Windows {powerStatus.action === 'restart' ? 'yeniden başlatılacak' : 'tamamen kapatılacak'}. İptal etmek için butona dokunabilirsiniz.
          </p>
        </div>
      )}

      {/* 3. Timed Shutdown / Sleep Scheduler ("Zamanlı Kapatıcı") */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
            <Clock className="w-4 h-4 text-brand-400" />
            Zamanlı Kapatıcı (Zamanlayıcı)
          </div>

          {/* Action toggle (Shutdown vs Restart) */}
          <div className="flex bg-dark-900 rounded-xl p-0.5 border border-slate-700">
            <button
              onClick={() => {
                vibrate(5);
                setTargetAction('shutdown');
              }}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors ${
                targetAction === 'shutdown'
                  ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Kapat
            </button>
            <button
              onClick={() => {
                vibrate(5);
                setTargetAction('restart');
              }}
              className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-colors ${
                targetAction === 'restart'
                  ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Yeniden Başlat
            </button>
          </div>
        </div>

        <p className="text-xs text-slate-400">
          Belirttiğiniz süre sonunda Windows otomatik olarak {targetAction === 'shutdown' ? 'kapanır' : 'yeniden başlar'}.
        </p>

        {/* Quick Presets Grid */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: '15 dk', min: 15 },
            { label: '30 dk', min: 30, primary: true },
            { label: '45 dk', min: 45 },
            { label: '1 Saat', min: 60 },
            { label: '1.5 Saat', min: 90 },
            { label: '2 Saat', min: 120 }
          ].map((preset) => (
            <button
              key={preset.min}
              onClick={() => handleSchedulePreset(preset.min)}
              className={`h-12 rounded-2xl flex flex-col items-center justify-center font-bold text-xs transition-all active:scale-95 border ${
                preset.primary
                  ? 'bg-brand-500/20 text-brand-300 border-brand-500/50 hover:bg-brand-500/30 shadow-lg shadow-brand-500/10'
                  : 'bg-dark-900 text-slate-300 border-slate-700 hover:bg-dark-700'
              }`}
            >
              <span>{preset.label}</span>
              <span className="text-[9px] text-slate-400 font-normal font-mono">sonra kapat</span>
            </button>
          ))}
        </div>

        {/* Custom Minutes Input Form */}
        <form onSubmit={handleCustomSchedule} className="flex items-center gap-2 pt-1">
          <div className="relative flex-1">
            <input
              type="number"
              min="1"
              max="720"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full h-11 bg-dark-900 border border-slate-700 rounded-xl px-3 text-sm text-white font-mono focus:outline-none focus:border-brand-500"
              placeholder="Dakika girin"
            />
            <span className="absolute right-3 top-3 text-xs text-slate-400">dakika</span>
          </div>
          <button
            type="submit"
            className="h-11 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 active:scale-95 text-white font-bold text-xs shadow-md shadow-brand-500/20 transition-all flex items-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5" />
            Başlat
          </button>
        </form>
      </div>

      {/* 4. Instant Power Controls */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-3.5">
        <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Anlık Güç & Oturum Seçenekleri
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {/* Lock Workstation */}
          <button
            onClick={() => handleInstantAction('lock')}
            className="h-20 rounded-2xl bg-dark-900 border border-slate-700 hover:border-sky-500/50 active:bg-sky-950/20 active:scale-95 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all shadow-md"
          >
            <Lock className="w-6 h-6 text-sky-400" />
            <span className="text-[11px] font-bold">Kilitle</span>
          </button>

          {/* Sleep Mode */}
          <button
            onClick={() => handleInstantAction('sleep')}
            className="h-20 rounded-2xl bg-dark-900 border border-slate-700 hover:border-indigo-500/50 active:bg-indigo-950/20 active:scale-95 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all shadow-md"
          >
            <Moon className="w-6 h-6 text-indigo-400" />
            <span className="text-[11px] font-bold">Uyku Modu</span>
          </button>

          {/* Turn Off Display */}
          <button
            onClick={() => handleInstantAction('displayOff')}
            className="h-20 rounded-2xl bg-dark-900 border border-slate-700 hover:border-purple-500/50 active:bg-purple-950/20 active:scale-95 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all shadow-md"
          >
            <Monitor className="w-6 h-6 text-purple-400" />
            <span className="text-[11px] font-bold">Ekranı Kapat</span>
          </button>
        </div>

        {/* Dangerous Actions (Restart & Shutdown with Modal Safety) */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {/* Restart Button */}
          <button
            onClick={() => promptDangerousAction('restart')}
            className="h-14 rounded-2xl bg-dark-900 border-2 border-amber-600/40 hover:bg-amber-950/20 active:scale-95 text-amber-300 flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-md"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
            Yeniden Başlat
          </button>

          {/* Shutdown Button */}
          <button
            onClick={() => promptDangerousAction('shutdown')}
            className="h-14 rounded-2xl bg-dark-900 border-2 border-rose-600/40 hover:bg-rose-950/20 active:scale-95 text-rose-300 flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-md"
          >
            <Power className="w-4 h-4 text-rose-400" />
            Bilgisayarı Kapat
          </button>
        </div>
      </div>

      {/* 5. Windows System Utilities */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-3.5">
        <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Windows Kısayolları ve Hızlı Araçlar
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {/* Task Manager */}
          <button
            onClick={() => handleInstantAction('taskManager')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-emerald-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
          >
            <Activity className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Görev Yöneticisi</div>
              <div className="text-[10px] text-slate-500 font-mono">Taskmgr</div>
            </div>
          </button>

          {/* Show Desktop */}
          <button
            onClick={() => handleInstantAction('showDesktop')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-cyan-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
          >
            <Layout className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Masaüstü</div>
              <div className="text-[10px] text-slate-500 font-mono">Win + D</div>
            </div>
          </button>

          {/* Task View */}
          <button
            onClick={() => handleInstantAction('taskView')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-blue-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
          >
            <Layers className="w-5 h-5 text-blue-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Görev Görünümü</div>
              <div className="text-[10px] text-slate-500 font-mono">Win + Tab</div>
            </div>
          </button>

          {/* Screenshot Tool */}
          <button
            onClick={() => handleInstantAction('screenshot')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-amber-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
          >
            <Camera className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Ekran Alıntısı</div>
              <div className="text-[10px] text-slate-500 font-mono">Win+Shift+S</div>
            </div>
          </button>
        </div>
      </div>

      {/* Safety Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-dark-900 border-2 border-rose-500/50 rounded-3xl p-6 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{confirmDialog.title}</h3>
                <p className="text-xs text-rose-400 font-medium">Onay Gerekiyor</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {confirmDialog.description}
            </p>

            <div className="flex items-center gap-2.5 pt-2">
              <button
                onClick={() => setConfirmDialog({ isOpen: false, action: null, title: '', description: '' })}
                className="flex-1 h-12 rounded-2xl bg-dark-800 hover:bg-dark-700 text-slate-300 font-bold text-xs border border-slate-700 active:scale-95 transition-all"
              >
                Vazgeç
              </button>
              <button
                onClick={confirmDangerousAction}
                className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-xs shadow-lg shadow-rose-600/30 active:scale-95 transition-all"
              >
                Evet, Onayla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

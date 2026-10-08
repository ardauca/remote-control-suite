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
        title: 'Shut Down Computer',
        description: 'Your PC will be shut down immediately. Any unsaved work may be lost. Are you sure you want to proceed?'
      });
    } else {
      setConfirmDialog({
        isOpen: true,
        action: 'restart',
        title: 'Restart Computer',
        description: 'Your PC will restart immediately. Any unsaved work may be lost. Are you sure you want to proceed?'
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
      return `${hours}h ${minutes.toString().padStart(2, '0')}m ${seconds.toString().padStart(2, '0')}s`;
    }
    return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
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
              System & Power Control
            </h2>
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-rose-500/20 text-rose-400 rounded-md border border-rose-500/30">
              v2.0
            </span>
          </div>
          <p className="text-xs text-slate-400">Workstation power states, sleep mode, and timed shutdown</p>
        </div>
        <button
          onClick={() => {
            vibrate(10);
            requestPowerStatus();
          }}
          title="Refresh power status"
          aria-label="Refresh power status"
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
                  {powerStatus.action === 'restart' ? 'Scheduled Restart Active' : 'Scheduled Shutdown Active'}
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
              Cancel
            </button>
          </div>
          <p className="text-[11px] text-slate-400 mt-2">
            Windows will {powerStatus.action === 'restart' ? 'restart automatically' : 'shut down completely'}. Tap Cancel at any time.
          </p>
        </div>
      )}

      {/* 3. Timed Shutdown / Sleep Scheduler */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-200 uppercase tracking-wider">
            <Clock className="w-4 h-4 text-brand-400" />
            Timed Auto-Shutdown
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
              Shutdown
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
              Restart
            </button>
          </div>
        </div>

        {/* Compact Custom Minutes Scheduler (Single Row Stepper & Start) */}
        <form onSubmit={handleCustomSchedule} className="flex items-center gap-2 pt-1">
          {/* Quick -10m */}
          <button
            type="button"
            onClick={() => {
              vibrate(10);
              setCustomMinutes((m) => Math.max(5, m - 10));
            }}
            className="w-11 h-11 rounded-xl bg-dark-900 border border-slate-700 text-slate-300 font-bold text-xs hover:bg-dark-700 active:scale-95 transition-all flex items-center justify-center"
            title="Decrease by 10 minutes"
            aria-label="Decrease by 10 minutes"
          >
            -10
          </button>

          {/* Number Input with Minutes Label */}
          <div className="relative flex-1">
            <input
              type="number"
              min="1"
              max="720"
              value={customMinutes}
              onChange={(e) => setCustomMinutes(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full h-11 bg-dark-900 border border-slate-700 rounded-xl pl-3 pr-14 text-base font-bold text-white font-mono focus:outline-none focus:border-brand-500 text-center"
              placeholder="Duration"
              aria-label="Shutdown timer minutes"
            />
            <span className="absolute right-3 top-3 text-xs text-slate-400 font-medium pointer-events-none">min</span>
          </div>

          {/* Quick +10m */}
          <button
            type="button"
            onClick={() => {
              vibrate(10);
              setCustomMinutes((m) => Math.min(720, m + 10));
            }}
            className="w-11 h-11 rounded-xl bg-dark-900 border border-slate-700 text-slate-300 font-bold text-xs hover:bg-dark-700 active:scale-95 transition-all flex items-center justify-center"
            title="Increase by 10 minutes"
            aria-label="Increase by 10 minutes"
          >
            +10
          </button>

          {/* Start Button */}
          <button
            type="submit"
            className="h-11 px-4 rounded-xl bg-gradient-to-r from-brand-500 to-indigo-600 hover:from-brand-600 hover:to-indigo-700 active:scale-95 text-white font-bold text-xs shadow-md shadow-brand-500/25 transition-all flex items-center gap-1.5"
          >
            <Clock className="w-4 h-4" />
            Start
          </button>
        </form>
      </div>

      {/* 4. Instant Power Controls */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-3.5">
        <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Instant Power & Session
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {/* Lock Workstation */}
          <button
            onClick={() => handleInstantAction('lock')}
            className="h-20 rounded-2xl bg-dark-900 border border-slate-700 hover:border-sky-500/50 active:bg-sky-950/20 active:scale-95 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all shadow-md"
            title="Lock PC (Win + L)"
            aria-label="Lock PC"
          >
            <Lock className="w-6 h-6 text-sky-400" />
            <span className="text-[11px] font-bold">Lock</span>
          </button>

          {/* Sleep Mode */}
          <button
            onClick={() => handleInstantAction('sleep')}
            className="h-20 rounded-2xl bg-dark-900 border border-slate-700 hover:border-indigo-500/50 active:bg-indigo-950/20 active:scale-95 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all shadow-md"
            title="Put PC to Sleep"
            aria-label="Sleep Mode"
          >
            <Moon className="w-6 h-6 text-indigo-400" />
            <span className="text-[11px] font-bold">Sleep</span>
          </button>

          {/* Turn Off Display */}
          <button
            onClick={() => handleInstantAction('displayOff')}
            className="h-20 rounded-2xl bg-dark-900 border border-slate-700 hover:border-purple-500/50 active:bg-purple-950/20 active:scale-95 text-slate-200 flex flex-col items-center justify-center gap-1.5 transition-all shadow-md"
            title="Turn Off Display"
            aria-label="Turn Off Display"
          >
            <Monitor className="w-6 h-6 text-purple-400" />
            <span className="text-[11px] font-bold">Display Off</span>
          </button>
        </div>

        {/* Dangerous Actions (Restart & Shutdown with Modal Safety) */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          {/* Restart Button */}
          <button
            onClick={() => promptDangerousAction('restart')}
            className="h-14 rounded-2xl bg-dark-900 border-2 border-amber-600/40 hover:bg-amber-950/20 active:scale-95 text-amber-300 flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-md"
            title="Restart PC"
            aria-label="Restart PC"
          >
            <RotateCcw className="w-4 h-4 text-amber-400" />
            Restart PC
          </button>

          {/* Shutdown Button */}
          <button
            onClick={() => promptDangerousAction('shutdown')}
            className="h-14 rounded-2xl bg-dark-900 border-2 border-rose-600/40 hover:bg-rose-950/20 active:scale-95 text-rose-300 flex items-center justify-center gap-2 font-bold text-xs transition-all shadow-md"
            title="Shut Down PC"
            aria-label="Shut Down PC"
          >
            <Power className="w-4 h-4 text-rose-400" />
            Shut Down PC
          </button>
        </div>
      </div>

      {/* 5. Windows System Utilities */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-5 border border-slate-700/60 shadow-xl space-y-3.5">
        <div className="text-xs font-bold text-slate-200 uppercase tracking-wider">
          Windows System Utilities
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          {/* Task Manager */}
          <button
            onClick={() => handleInstantAction('taskManager')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-emerald-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
            title="Task Manager"
            aria-label="Task Manager"
          >
            <Activity className="w-5 h-5 text-emerald-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Task Manager</div>
              <div className="text-[10px] text-slate-500 font-mono">Taskmgr</div>
            </div>
          </button>

          {/* Show Desktop */}
          <button
            onClick={() => handleInstantAction('showDesktop')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-cyan-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
            title="Show Desktop (Win + D)"
            aria-label="Show Desktop"
          >
            <Layout className="w-5 h-5 text-cyan-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Show Desktop</div>
              <div className="text-[10px] text-slate-500 font-mono">Win + D</div>
            </div>
          </button>

          {/* Task View */}
          <button
            onClick={() => handleInstantAction('taskView')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-blue-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
            title="Task View (Win + Tab)"
            aria-label="Task View"
          >
            <Layers className="w-5 h-5 text-blue-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Task View</div>
              <div className="text-[10px] text-slate-500 font-mono">Win + Tab</div>
            </div>
          </button>

          {/* Screenshot Tool */}
          <button
            onClick={() => handleInstantAction('screenshot')}
            className="h-14 rounded-2xl bg-dark-900 border border-slate-700 hover:border-amber-500/50 active:scale-95 text-slate-200 flex items-center gap-2.5 px-3.5 transition-all shadow-md"
            title="Snipping Tool / Screenshot"
            aria-label="Screenshot"
          >
            <Camera className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-left">
              <div className="text-xs font-bold leading-tight">Screenshot</div>
              <div className="text-[10px] text-slate-500 font-mono">Win+Shift+S</div>
            </div>
          </button>
        </div>
      </div>

      {/* Safety Confirmation Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-sm bg-dark-900 border-2 border-rose-500/50 rounded-3xl p-6 shadow-2xl space-y-4 animate-scaleUp">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-6 h-6 text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">{confirmDialog.title}</h3>
                <p className="text-xs text-rose-400 font-semibold tracking-wide uppercase">Confirmation Required</p>
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
                Cancel
              </button>
              <button
                onClick={confirmDangerousAction}
                className="flex-1 h-12 rounded-2xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white font-bold text-xs shadow-lg shadow-rose-600/30 active:scale-95 transition-all"
              >
                Yes, Proceed
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

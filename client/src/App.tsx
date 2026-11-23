import React, { useCallback, useEffect, useState } from 'react';
import { wsClient } from './protocol/wsClient';
import { useConnectionStore } from './stores/connectionStore';
import { ConnectionStatusCard } from './features/status/ConnectionStatusCard';
import { PairingModal } from './features/status/PairingModal';
import { FeatureAccessGate } from './features/status/FeatureAccessGate';
import { NavigationBar, TabType } from './features/navigation/NavigationBar';
import { TouchpadView } from './features/touchpad/TouchpadView';
import { KeyboardControlBar } from './features/keyboard/KeyboardControlBar';
import { ScreenView } from './features/screen/ScreenView';
import { MediaControlView } from './features/media/MediaControlView';
import { PowerSystemView } from './features/power/PowerSystemView';
import { 
  Smartphone,
  CheckCircle,
  ShieldCheck,
  ShieldAlert,
  RefreshCw
} from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('remote');
  const [isPairingOpen, setIsPairingOpen] = useState(false);
  const [autoFocusKeyboard, setAutoFocusKeyboard] = useState(false);
  const [keyboardOpenedFromScreen, setKeyboardOpenedFromScreen] = useState(false);
  const [keyboardDraft, setKeyboardDraft] = useState('');
  const [keyboardDraftUnsent, setKeyboardDraftUnsent] = useState(false);
  const { status, hostHealth, isAuthenticated, latency } = useConnectionStore();

  const openKeyboardForTyping = useCallback(() => {
    setAutoFocusKeyboard(true);
    setKeyboardOpenedFromScreen(true);
    setActiveTab('keyboard');
  }, []);

  const handleTabChange = useCallback((tab: TabType) => {
    if (tab === 'keyboard') {
      setAutoFocusKeyboard(true);
      setKeyboardOpenedFromScreen(false);
    } else {
      setKeyboardOpenedFromScreen(false);
    }
    setActiveTab(tab);
  }, []);

  useEffect(() => {
    // Attempt auto-connect on startup
    wsClient.connect();

    return () => {
      // Cleanup on unmount
    };
  }, []);

  useEffect(() => {
    if (status === 'connected' && hostHealth === 'responsive' && !isAuthenticated) {
      setIsPairingOpen(true);
    } else if (isAuthenticated) {
      setIsPairingOpen(false);
    }
  }, [status, hostHealth, isAuthenticated]);

  // Screen Wake Lock: Keep phone screen awake while connected to prevent auto-lock during remote control
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let wakeLockSentinel: any = null;

    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && status === 'connected' && document.visibilityState === 'visible') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        } catch {
          // Ignore - e.g. low power mode or battery saver
        }
      }
    };

    const releaseWakeLock = () => {
      if (wakeLockSentinel) {
        wakeLockSentinel.release().catch(() => {});
        wakeLockSentinel = null;
      }
    };

    if (status === 'connected') {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && status === 'connected') {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseWakeLock();
    };
  }, [status]);

  return (
    <div className="flex flex-col h-full w-full bg-dark-900 text-slate-100 select-none overflow-hidden">
      {/* Top Header with iOS Safe Area */}
      <header className="shrink-0 bg-dark-900/95 backdrop-blur-2xl border-b border-slate-800/80 px-4 pt-3 pb-2.5 safe-top z-30">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 via-indigo-500 to-cyan-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
              <Smartphone className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5 leading-none">
                Remote Suite
                <span className="text-[9px] font-mono text-slate-400 bg-slate-800/80 px-1 py-0.5 rounded border border-slate-700/60">v1.3</span>
              </h1>
              <p className="text-[10px] text-slate-400 font-medium mt-0.5">iPhone to Windows Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {status === 'connected' && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                isAuthenticated 
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}>
                {isAuthenticated ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                {isAuthenticated ? 'Paired' : 'Unpaired'}
              </span>
            )}

            {/* Real-time Connection Quality & Instant Reconnect Pill */}
            <button
              onClick={() => {
                if (status === 'disconnected') {
                  if ('vibrate' in navigator) navigator.vibrate(10);
                  wsClient.connect();
                } else if (status === 'connected' && hostHealth === 'stale') {
                  if ('vibrate' in navigator) navigator.vibrate(10);
                  wsClient.reconnectImmediate();
                }
              }}
              disabled={status === 'connecting' || status === 'reconnecting' || (status === 'connected' && hostHealth === 'checking')}
              aria-label={`Connection Status: ${status === 'connected' ? hostHealth : status}${latency !== null ? `, Latency: ${latency}ms` : ''}`}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold border transition-all active:scale-95 ${
                status === 'connected' && hostHealth === 'responsive'
                  ? latency !== null && latency > 90
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                  : status === 'connected' && hostHealth === 'stale'
                  ? 'bg-rose-500/15 text-rose-300 border-rose-500/40 cursor-pointer'
                  : status === 'connected'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
                  : status === 'connecting' || status === 'reconnecting'
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse'
                  : 'bg-rose-500/15 text-rose-300 border-rose-500/40 hover:bg-rose-500/25 cursor-pointer shadow-sm shadow-rose-950/40'
              }`}
            >
              {status === 'connected' && hostHealth !== 'responsive' ? (
                <RefreshCw className={`w-3 h-3 ${hostHealth === 'checking' ? 'animate-spin' : ''}`} />
              ) : (
                <span className={`w-2 h-2 rounded-full ${
                status === 'connected' && hostHealth === 'responsive'
                  ? latency !== null && latency > 90 
                    ? 'bg-amber-400 shadow-sm shadow-amber-400/50' 
                    : 'bg-emerald-400 shadow-sm shadow-emerald-400/60 animate-pulse'
                  : status === 'connecting' || status === 'reconnecting' 
                  ? 'bg-amber-400 animate-ping'
                  : 'bg-rose-500'
              }`} />
              )}
              <span>
                {status === 'connected'
                  ? hostHealth === 'responsive'
                    ? latency !== null ? `${latency} ms` : 'Connected'
                    : hostHealth === 'stale' ? 'PC not responding' : 'Checking PC...'
                  : status === 'reconnecting'
                  ? 'Reconnecting...'
                  : status === 'connecting'
                  ? 'Connecting...'
                  : 'Reconnect'}
              </span>
            </button>
          </div>
        </div>
      </header>

      {/* Pairing Modal (Active when connected and unauthenticated) */}
      <PairingModal
        isOpen={isPairingOpen}
        onClose={() => setIsPairingOpen(false)}
      />

      {/* Main View Area */}
      <main className={`flex-1 ${
        activeTab === 'remote' 
          ? 'overflow-hidden p-2 flex flex-col touch-none' 
          : activeTab === 'screen'
          ? 'overflow-y-auto px-3 py-3 space-y-3'
          : 'overflow-y-auto px-4 py-4 space-y-4'
      }`}>
        {activeTab === 'more' && (
          <div className="max-w-md mx-auto space-y-4">
            <FeatureAccessGate onPair={() => setIsPairingOpen(true)}>
              <PowerSystemView />
            </FeatureAccessGate>

            <ConnectionStatusCard onPair={() => setIsPairingOpen(true)} />

            <div className="bg-dark-800/50 rounded-2xl p-4 border border-slate-800 text-xs space-y-3">
              <h3 className="font-semibold text-slate-200 flex items-center gap-1.5">
                {isAuthenticated
                  ? <CheckCircle className="w-4 h-4 text-emerald-400" />
                  : <ShieldAlert className="w-4 h-4 text-amber-400" />}
                {isAuthenticated ? 'Your PC is ready' : 'Get started'}
              </h3>
              {isAuthenticated ? (
                <>
                  <p className="text-slate-400">Choose what you want to control.</p>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ['remote', 'Touchpad', 'Move the mouse and click'],
                      ['keyboard', 'Keyboard', 'Type and use shortcuts'],
                      ['screen', 'Screen', 'View and tap your PC screen'],
                      ['media', 'Media', 'Control playback and volume'],
                    ] as const).map(([tab, title, description]) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => handleTabChange(tab)}
                        className="rounded-xl border border-slate-700/80 bg-dark-900/70 p-3 text-left transition-colors hover:border-brand-500/50 hover:bg-dark-900"
                      >
                        <span className="block font-semibold text-slate-100">{title}</span>
                        <span className="mt-1 block text-[10px] leading-relaxed text-slate-400">{description}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <ol className="space-y-2 text-slate-400">
                  <li><span className="mr-2 font-semibold text-brand-400">1.</span>Connect to your Windows PC using its local address.</li>
                  <li><span className="mr-2 font-semibold text-brand-400">2.</span>Enter the pairing PIN shown in the PC dashboard.</li>
                  <li><span className="mr-2 font-semibold text-brand-400">3.</span>Choose Touchpad, Keyboard, Screen or Media below.</li>
                </ol>
              )}
            </div>
          </div>
        )}

        {activeTab === 'remote' && (
          <FeatureAccessGate onPair={() => setIsPairingOpen(true)}>
            <TouchpadView />
          </FeatureAccessGate>
        )}

        {activeTab === 'keyboard' && (
          <FeatureAccessGate onPair={() => setIsPairingOpen(true)}>
            <div className="mx-auto w-full max-w-md space-y-3 pb-16">
              <div className="px-1">
                <h2 className="text-lg font-bold text-white">Keyboard & Shortcuts</h2>
                <p className="mt-1 text-xs text-slate-400">
                  {keyboardOpenedFromScreen
                    ? 'PC text field selected. Type here; if the phone keyboard stays hidden, tap the input. Return to Screen when done.'
                    : 'Type on your PC or send a shortcut.'}
                </p>
              </div>
              <KeyboardControlBar
                textInput={keyboardDraft}
                onTextInputChange={setKeyboardDraft}
                isTextUnsent={keyboardDraftUnsent}
                onTextUnsentChange={setKeyboardDraftUnsent}
                autoFocusInput={autoFocusKeyboard}
                onAutoFocusHandled={() => setAutoFocusKeyboard(false)}
              />
            </div>
          </FeatureAccessGate>
        )}

        {activeTab === 'screen' && (
          <FeatureAccessGate onPair={() => setIsPairingOpen(true)}>
            <ScreenView onTextInputFocus={openKeyboardForTyping} />
          </FeatureAccessGate>
        )}

        {activeTab === 'media' && (
          <FeatureAccessGate onPair={() => setIsPairingOpen(true)}>
            <MediaControlView />
          </FeatureAccessGate>
        )}

      </main>

      {/* Bottom Mobile Navigation */}
      <NavigationBar activeTab={activeTab} onTabChange={handleTabChange} />
    </div>
  );
};

export default App;

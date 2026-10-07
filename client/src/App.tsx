import React, { useEffect, useState } from 'react';
import { wsClient } from './protocol/wsClient';
import { useConnectionStore } from './stores/connectionStore';
import { ConnectionStatusCard } from './features/status/ConnectionStatusCard';
import { PairingModal } from './features/status/PairingModal';
import { NavigationBar, TabType } from './features/navigation/NavigationBar';
import { TouchpadView } from './features/touchpad/TouchpadView';
import { ScreenView } from './features/screen/ScreenView';
import { MediaControlView } from './features/media/MediaControlView';
import { PowerSystemView } from './features/power/PowerSystemView';
import { 
  Smartphone,
  CheckCircle,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const { status, isAuthenticated } = useConnectionStore();

  useEffect(() => {
    // Attempt auto-connect on startup
    wsClient.connect();

    return () => {
      // Cleanup on unmount
    };
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-dark-900 text-slate-100 select-none overflow-hidden">
      {/* Top Header with iOS Safe Area */}
      <header className="shrink-0 bg-dark-800/80 backdrop-blur-xl border-b border-slate-800/80 px-4 pt-3 pb-3 safe-top">
        <div className="flex items-center justify-between max-w-md mx-auto">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-brand-600 to-cyan-400 flex items-center justify-center shadow-lg shadow-brand-500/20">
              <Smartphone className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                Remote Suite
                <span className="text-[10px] font-normal text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">v1.0</span>
              </h1>
              <p className="text-[11px] text-slate-400">iPhone to Windows Hub</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
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
            <div className={`w-2.5 h-2.5 rounded-full ${
              status === 'connected' ? 'bg-emerald-400 shadow-md shadow-emerald-400/50' : 
              status === 'connecting' || status === 'reconnecting' ? 'bg-amber-400 animate-ping' : 
              'bg-rose-500'
            }`} />
            <span className="text-xs font-medium text-slate-300 capitalize">{status}</span>
          </div>
        </div>
      </header>

      {/* Pairing Modal (Active when connected and unauthenticated) */}
      <PairingModal />

      {/* Main View Area */}
      <main className={`flex-1 ${
        activeTab === 'remote' 
          ? 'overflow-hidden p-2 flex flex-col touch-none' 
          : activeTab === 'screen'
          ? 'overflow-y-auto px-3 py-3 space-y-3'
          : 'overflow-y-auto px-4 py-4 space-y-4'
      }`}>
        {activeTab === 'home' && (
          <div className="max-w-md mx-auto space-y-4">
            <ConnectionStatusCard />

            {/* Quick Guide Card */}
            <div className="bg-dark-800/50 rounded-2xl p-4 border border-slate-800 text-xs space-y-2">
              <h3 className="font-semibold text-slate-200 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-400" />
                Phase 1-7 Acceptance Milestones
              </h3>
              <ul className="text-slate-400 space-y-1.5 list-disc list-inside">
                <li>.NET 9 Windows Agent with Kestrel Web/WS server running</li>
                <li>Real-time bidirectional WebSocket at <code className="text-brand-400">/ws</code></li>
                <li>Virtual Trackpad & Gesture Mouse Control (Phase 3)</li>
                <li>Raw & Unicode Keyboard Input with IME Support (Phase 4)</li>
                <li>WASAPI Volume, Per-App Audio & GSMTC Now Playing Media (Phase 5)</li>
                <li>System Power & Timed Shutdown Scheduler (Phase 6)</li>
                <li>Ultra-Low Latency Screen Mirroring & Remote Touch (Phase 7)</li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'remote' && (
          <TouchpadView />
        )}

        {activeTab === 'screen' && (
          <ScreenView />
        )}

        {activeTab === 'media' && (
          <MediaControlView />
        )}

        {activeTab === 'more' && (
          <PowerSystemView />
        )}
      </main>

      {/* Bottom Mobile Navigation */}
      <NavigationBar activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
};

export default App;

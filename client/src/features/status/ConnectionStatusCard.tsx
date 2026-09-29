import React, { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { wsClient } from '../../protocol/wsClient';
import { 
  Wifi, 
  WifiOff, 
  Activity, 
  Server, 
  RefreshCw, 
  Terminal, 
  ChevronDown, 
  ChevronUp, 
  ShieldCheck
} from 'lucide-react';

export const ConnectionStatusCard: React.FC = () => {
  const { 
    status, 
    serverUrl, 
    latency, 
    serverInfo, 
    reconnectAttempts, 
    logs, 
    setServerUrl, 
    clearLogs 
  } = useConnectionStore();

  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [showLogs, setShowLogs] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setServerUrl(inputUrl);
    wsClient.connect(inputUrl);
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            Connected
          </span>
        );
      case 'connecting':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Connecting...
          </span>
        );
      case 'reconnecting':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <RefreshCw className="w-3 h-3 animate-spin" />
            Reconnecting ({reconnectAttempts})
          </span>
        );
      case 'disconnected':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <WifiOff className="w-3 h-3" />
            Disconnected
          </span>
        );
    }
  };

  return (
    <div className="w-full max-w-md mx-auto space-y-4">
      {/* Primary Status Card */}
      <div className="bg-dark-800/80 backdrop-blur-md rounded-2xl p-5 border border-slate-800 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className={`p-2.5 rounded-xl ${status === 'connected' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
              <Server className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white tracking-tight">
                {serverInfo ? serverInfo.serverName : 'Windows Host'}
              </h2>
              <p className="text-xs text-slate-400">
                {serverInfo ? serverInfo.os : 'Ready for connection'}
              </p>
            </div>
          </div>
          {getStatusBadge()}
        </div>

        {/* Real-time Metrics (Latency, Heartbeat, Protocol) */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="bg-dark-900/60 rounded-xl p-3 border border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Ping / Latency</span>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="text-lg font-bold text-white tracking-tight">
              {status === 'connected' && latency !== null ? (
                <span className="text-emerald-400">{latency} ms</span>
              ) : (
                <span className="text-slate-500">--</span>
              )}
            </div>
          </div>

          <div className="bg-dark-900/60 rounded-xl p-3 border border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Protocol</span>
              <ShieldCheck className="w-3.5 h-3.5 text-brand-500" />
            </div>
            <div className="text-lg font-bold text-white tracking-tight">
              <span>v1.0 (LAN)</span>
            </div>
          </div>
        </div>

        {/* Capabilities Pill List */}
        {serverInfo && serverInfo.capabilities && serverInfo.capabilities.length > 0 && (
          <div className="pt-2 border-t border-slate-800/60">
            <div className="text-[11px] font-medium text-slate-400 uppercase tracking-wider mb-2">
              Discovered Capabilities
            </div>
            <div className="flex flex-wrap gap-1.5">
              {serverInfo.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="px-2 py-0.5 rounded-md text-[11px] font-mono bg-dark-900 text-slate-300 border border-slate-700/60"
                >
                  {cap}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Quick Actions */}
        <div className="flex items-center gap-2 pt-1">
          {status === 'connected' ? (
            <button
              onClick={() => wsClient.disconnect()}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={() => wsClient.connect(serverUrl)}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-medium bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/25 transition-all active:scale-[0.98]"
            >
              Connect Now
            </button>
          )}

          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-2.5 rounded-xl bg-dark-700 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
            title="Configure Host URL"
          >
            <Wifi className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Host URL Configuration (Expandable) */}
      {showSettings && (
        <form onSubmit={handleConnect} className="bg-dark-800 rounded-2xl p-4 border border-slate-800 space-y-3">
          <label className="block text-xs font-semibold text-slate-300">
            Windows Host WebSocket URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="ws://192.168.1.50:52520/ws"
              className="flex-1 px-3 py-2 text-xs bg-dark-900 text-white rounded-xl border border-slate-700 focus:outline-none focus:border-brand-500 font-mono"
            />
            <button
              type="submit"
              className="px-4 py-2 text-xs font-medium bg-brand-500 hover:bg-brand-600 text-white rounded-xl"
            >
              Save & Test
            </button>
          </div>
          <p className="text-[11px] text-slate-500">
            Open the System Tray icon on your Windows PC and click "View Local Network IPs" to find your address.
          </p>
        </form>
      )}

      {/* Live Diagnostics & Heartbeat Logs Drawer */}
      <div className="bg-dark-800/60 rounded-2xl border border-slate-800/80 overflow-hidden">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="w-full flex items-center justify-between p-3.5 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-cyan-400" />
            <span>Connection Diagnostics ({logs.length})</span>
          </div>
          {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showLogs && (
          <div className="p-3 border-t border-slate-800 bg-dark-900/90 font-mono text-[11px] space-y-1.5 max-h-48 overflow-y-auto">
            <div className="flex justify-between items-center pb-1 mb-1 border-b border-slate-800 text-[10px] text-slate-500">
              <span>LIVE LOG STREAM</span>
              <button onClick={clearLogs} className="hover:text-slate-300 underline">
                Clear
              </button>
            </div>
            {logs.length === 0 ? (
              <div className="text-slate-600 py-2 text-center">No logs recorded yet</div>
            ) : (
              logs.map((log) => (
                <div key={log.id} className="flex items-start gap-2 leading-tight">
                  <span className="text-slate-500 shrink-0">{log.time}</span>
                  <span
                    className={
                      log.level === 'success'
                        ? 'text-emerald-400'
                        : log.level === 'warn'
                        ? 'text-amber-400'
                        : log.level === 'error'
                        ? 'text-rose-400'
                        : 'text-slate-300'
                    }
                  >
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { wsClient } from '../../protocol/wsClient';
import { 
  Wifi, 
  WifiOff, 
  Activity, 
  Server, 
  RefreshCw, 
  ShieldCheck,
  Clipboard,
  Check
} from 'lucide-react';

interface ConnectionStatusCardProps {
  onPair: () => void;
}

export const ConnectionStatusCard: React.FC<ConnectionStatusCardProps> = ({ onPair }) => {
  const { 
    status, 
    hostHealth,
    serverUrl, 
    latency, 
    serverInfo, 
    reconnectAttempts, 
    logs, 
    isAuthenticated,
    deviceName,
    setServerUrl
  } = useConnectionStore();

  const [inputUrl, setInputUrl] = useState(serverUrl);
  const [showSettings, setShowSettings] = useState(false);
  const [diagnosticsCopied, setDiagnosticsCopied] = useState(false);

  const copyDiagnostics = async () => {
    const pointer = wsClient.getPointerDiagnostics();
    const diagnostics = [
      'Remote Suite connection diagnostics',
      'Client version: 1.3',
      `Time: ${new Date().toISOString()}`,
      `Status: ${status}`,
      `Windows host responsiveness: ${hostHealth}`,
      `Authorized: ${isAuthenticated ? `Yes (${deviceName || 'Paired Device'})` : 'No'}`,
      `Server: ${serverInfo?.serverName || 'Unknown'} (${serverInfo?.os || 'Unknown OS'})`,
      `WebSocket: ${serverUrl}`,
      `Latency: ${latency === null ? 'Unavailable' : `${latency} ms`}`,
      `Reconnect attempts: ${reconnectAttempts}`,
      `Touchpad mouse.move: ${pointer.attempted} attempted, ${pointer.sent} sent, ${pointer.blocked} blocked, ${pointer.errors} send errors`,
      `Last pointer delta: ${pointer.lastDelta ? `${pointer.lastDelta.dx}, ${pointer.lastDelta.dy}` : 'None'}`,
      `Last pointer send: ${pointer.lastSentAt ? new Date(pointer.lastSentAt).toISOString() : 'None'}`,
      `Windows mouse input: ${pointer.windowsAccepted} accepted, ${pointer.windowsRejected} rejected`,
      `Last Windows mouse ack: ${pointer.lastWindowsAck ? `${pointer.lastWindowsAck.accepted ? 'accepted' : 'REJECTED'} (${pointer.lastWindowsAck.dx}, ${pointer.lastWindowsAck.dy}) at ${new Date(pointer.lastWindowsAck.at).toISOString()}` : 'None (no mouse movement reached the Windows input handler)'}`,
      '',
      'Recent events:',
      ...(logs.length > 0
        ? logs.slice(0, 30).map((log) => `${log.time} [${log.level.toUpperCase()}] ${log.message}`)
        : ['No connection events recorded'])
    ].join('\n');

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(diagnostics);
      } else {
        const temporaryInput = document.createElement('textarea');
        temporaryInput.value = diagnostics;
        temporaryInput.readOnly = true;
        temporaryInput.style.position = 'fixed';
        temporaryInput.style.opacity = '0';
        temporaryInput.style.fontSize = '16px';
        document.body.appendChild(temporaryInput);
        temporaryInput.focus();
        temporaryInput.select();
        temporaryInput.setSelectionRange(0, temporaryInput.value.length);
        const copied = document.execCommand('copy');
        temporaryInput.remove();
        if (!copied) throw new Error('Clipboard copy was rejected');
      }

      setDiagnosticsCopied(true);
      window.setTimeout(() => setDiagnosticsCopied(false), 2500);
    } catch {
      setDiagnosticsCopied(false);
      useConnectionStore.getState().addLog('warn', 'Could not copy diagnostics. Please try again.');
    }
  };

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setServerUrl(inputUrl);
    wsClient.connect(inputUrl);
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'connected':
        if (hostHealth === 'responsive') {
          return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              Connected
            </span>
          );
        }
        return (
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${hostHealth === 'stale' ? 'bg-rose-500/10 text-rose-300 border-rose-500/20' : 'bg-amber-500/10 text-amber-400 border-amber-500/20'}`}>
            <RefreshCw className={`w-3 h-3 ${hostHealth === 'checking' ? 'animate-spin' : ''}`} />
            {hostHealth === 'stale' ? 'PC not responding' : 'Checking PC...'}
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
            <div className={`p-2.5 rounded-xl ${status === 'connected' && hostHealth === 'responsive' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
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

        {/* Real-time Metrics (Latency, Signal Quality, Transport) */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="bg-dark-900/60 rounded-xl p-3 border border-slate-800/80">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
              <span>Ping & Quality</span>
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className="flex items-baseline justify-between">
              <div className="text-lg font-bold text-white tracking-tight">
                {status === 'connected' && latency !== null ? (
                  <span className={latency < 40 ? 'text-emerald-400' : latency < 100 ? 'text-amber-400' : 'text-rose-400'}>
                    {latency} ms
                  </span>
                ) : (
                  <span className="text-slate-500">--</span>
                )}
              </div>
              {status === 'connected' && latency !== null && (
                <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded ${
                  latency < 40 
                    ? 'bg-emerald-500/15 text-emerald-400' 
                    : latency < 100 
                    ? 'bg-amber-500/15 text-amber-300' 
                    : 'bg-rose-500/15 text-rose-300'
                }`}>
                  {latency < 40 ? 'Good' : latency < 100 ? 'Fair' : 'Slow'}
                </span>
              )}
            </div>
            {status === 'connected' && (
              <button
                type="button"
                onClick={() => {
                  if ('vibrate' in navigator) navigator.vibrate(5);
                  useConnectionStore.getState().setHostHealth('checking');
                  wsClient.send('heartbeat', 'system.ping', { clientTime: Date.now() });
                }}
                className="mt-2 text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1 font-medium transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5" />
                Ping Now
              </button>
            )}
          </div>

          <div className="bg-dark-900/60 rounded-xl p-3 border border-slate-800/80 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>Transport</span>
                <ShieldCheck className="w-3.5 h-3.5 text-brand-500" />
              </div>
              <div className="text-lg font-bold text-white tracking-tight">
                <span>WebSocket</span>
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">{serverInfo ? `Windows host v${serverInfo.version}` : 'Local network'}</div>
            </div>
            {status !== 'connected' && (
              <button
                type="button"
                onClick={() => {
                  if ('vibrate' in navigator) navigator.vibrate(10);
                  wsClient.connect(inputUrl);
                }}
                className="mt-2 text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 font-medium font-mono transition-colors"
              >
                <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                Connect Now
              </button>
            )}
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

        {/* Security & Pairing Status Banner */}
        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${isAuthenticated ? 'bg-emerald-400' : 'bg-amber-400'}`} />
            <span className="text-xs text-slate-300">
              {isAuthenticated
                ? `Authorized (${deviceName || 'Paired Device'})`
                : status === 'connected' && hostHealth === 'responsive' ? 'Pair this device to enable controls' : 'Pairing is available after the PC responds'}
            </span>
          </div>
          {isAuthenticated ? (
            <button
              onClick={() => {
                useConnectionStore.getState().clearAuth();
                wsClient.disconnect();
              }}
              className="text-[11px] text-rose-400 hover:text-rose-300 underline"
            >
              Unpair
            </button>
          ) : status === 'connected' && hostHealth === 'responsive' ? (
            <button
              type="button"
              onClick={onPair}
              className="rounded-lg bg-brand-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-brand-300 transition-colors hover:bg-brand-500/25"
            >
              Pair now
            </button>
          ) : null}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center gap-2 pt-1">
          {status === 'connected' && hostHealth === 'stale' ? (
            <button
              onClick={() => wsClient.reconnectImmediate()}
              className="flex-1 py-2.5 px-4 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white shadow-lg shadow-brand-500/25 transition-all active:scale-[0.98]"
            >
              Reconnect Now
            </button>
          ) : status === 'connected' ? (
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

      <button
        type="button"
        onClick={copyDiagnostics}
        className="w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-800/80 bg-dark-800/60 p-3.5 text-xs font-medium text-slate-300 transition-colors hover:bg-dark-800 hover:text-white active:scale-[0.99]"
      >
        {diagnosticsCopied ? <Check className="h-4 w-4 text-emerald-400" /> : <Clipboard className="h-4 w-4 text-cyan-400" />}
        <span>{diagnosticsCopied ? 'Diagnostics copied' : `Copy diagnostics (${logs.length})`}</span>
      </button>
    </div>
  );
};

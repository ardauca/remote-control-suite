import React from 'react';
import { Activity, Link2, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { wsClient } from '../../protocol/wsClient';

interface FeatureAccessGateProps {
  children: React.ReactNode;
  onPair: () => void;
}

export const FeatureAccessGate: React.FC<FeatureAccessGateProps> = ({ children, onPair }) => {
  const status = useConnectionStore((state) => state.status);
  const hostHealth = useConnectionStore((state) => state.hostHealth);
  const isAuthenticated = useConnectionStore((state) => state.isAuthenticated);
  const authPending = useConnectionStore((state) => state.authPending);

  if (status === 'connected' && hostHealth === 'responsive' && isAuthenticated) return <>{children}</>;

  const isConnected = status === 'connected';
  const isTrying = status === 'connecting' || status === 'reconnecting';
  const isHostChecking = isConnected && hostHealth !== 'stale' && hostHealth !== 'responsive';
  const isHostStale = isConnected && hostHealth === 'stale';
  const isAuthChecking = isConnected && hostHealth === 'responsive' && authPending && !isAuthenticated;
  const needsPairing = isConnected && hostHealth === 'responsive' && !authPending && !isAuthenticated;

  const title = isTrying
      ? 'Connecting to your PC…'
      : isHostStale
        ? 'Your PC is not responding'
        : isHostChecking
          ? 'Checking your PC…'
        : isAuthChecking
          ? 'Verifying this iPhone…'
          : needsPairing
            ? 'Pair your device to continue'
            : 'Connect to your PC first';

  const description = isTrying
      ? 'Your controls will be ready as soon as the connection is established.'
      : isHostStale
        ? 'The connection is open, but Windows has not answered recently. Reconnect to restore control.'
        : isHostChecking
          ? 'Waiting for a fresh response from Windows before enabling controls.'
          : isAuthChecking
            ? 'Checking the saved authorization with Windows.'
            : needsPairing
              ? 'Enter the PIN shown in the Windows dashboard to enable remote controls.'
              : 'Use the Windows PC address on the More tab to start a connection.';

  const handleReconnect = () => {
    if ('vibrate' in navigator) navigator.vibrate(10);
    if (isHostStale) wsClient.reconnectImmediate();
    else wsClient.connect();
  };

  return (
    <section role="status" aria-live="polite" className="mx-auto flex min-h-[55vh] w-full max-w-md flex-col items-center justify-center px-6 text-center animate-fadeIn">
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${needsPairing ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : isHostStale ? 'border-rose-500/30 bg-rose-500/10 text-rose-300' : isHostChecking || isAuthChecking || isTrying ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 bg-dark-800 text-slate-300'}`}>
        {needsPairing ? <ShieldCheck className="h-6 w-6" /> : isHostChecking || isAuthChecking || isTrying ? <Activity className="h-6 w-6 animate-pulse" /> : <WifiOff className="h-6 w-6" />}
      </div>
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-400">{description}</p>
      {needsPairing ? (
        <button type="button" onClick={onPair} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400">
          <Link2 className="h-4 w-4" />
          Enter pairing PIN
        </button>
      ) : !isTrying && !isHostChecking ? (
        <button type="button" onClick={handleReconnect} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400">
          {isHostStale && <RefreshCw className="h-4 w-4" />}
          {isHostStale ? 'Reconnect now' : 'Connect now'}
        </button>
      ) : null}
    </section>
  );
};

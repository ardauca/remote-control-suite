import React from 'react';
import { Link2, ShieldCheck, WifiOff } from 'lucide-react';
import { useConnectionStore } from '../../stores/connectionStore';
import { wsClient } from '../../protocol/wsClient';

interface FeatureAccessGateProps {
  children: React.ReactNode;
  onPair: () => void;
}

export const FeatureAccessGate: React.FC<FeatureAccessGateProps> = ({ children, onPair }) => {
  const status = useConnectionStore((state) => state.status);
  const isAuthenticated = useConnectionStore((state) => state.isAuthenticated);

  if (status === 'connected' && isAuthenticated) return <>{children}</>;

  const isConnected = status === 'connected';
  const isTrying = status === 'connecting' || status === 'reconnecting';

  return (
    <section className="mx-auto flex min-h-[55vh] w-full max-w-md flex-col items-center justify-center px-6 text-center animate-fadeIn">
      <div className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border ${isConnected ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-slate-700 bg-dark-800 text-slate-300'}`}>
        {isConnected ? <ShieldCheck className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
      </div>
      <h2 className="text-lg font-semibold text-white">
        {isConnected ? 'Pair your device to continue' : isTrying ? 'Connecting to your PC…' : 'Connect to your PC first'}
      </h2>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-400">
        {isConnected
          ? 'Enter the PIN shown in the Windows dashboard to enable remote controls.'
          : isTrying
            ? 'Your controls will be ready as soon as the connection is established.'
            : 'Use the Windows PC address on the Home tab to start a connection.'}
      </p>
      {isConnected ? (
        <button type="button" onClick={onPair} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400">
          <Link2 className="h-4 w-4" />
          Enter pairing PIN
        </button>
      ) : !isTrying ? (
        <button type="button" onClick={() => wsClient.connect()} className="mt-5 rounded-xl bg-brand-500 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/20 transition-colors hover:bg-brand-400">
          Connect now
        </button>
      ) : null}
    </section>
  );
};

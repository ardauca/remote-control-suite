import React, { useState } from 'react';
import { useConnectionStore } from '../../stores/connectionStore';
import { wsClient } from '../../protocol/wsClient';
import { ShieldCheck, ShieldAlert, KeyRound, Smartphone } from 'lucide-react';

export const PairingModal: React.FC = () => {
  const { 
    status, 
    isAuthenticated, 
    serverInfo, 
    authError 
  } = useConnectionStore();

  const [pin, setPin] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(
    typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent) ? 'iPhone' : 'Safari Client'
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Only display when connected but unauthenticated
  if (status !== 'connected') {
    return null;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanDigits = pin.replace(/\D/g, '');
    if (cleanDigits.length < 6) return;
    setIsSubmitting(true);
    wsClient.pair(cleanDigits, deviceLabel);
    setTimeout(() => setIsSubmitting(false), 800);
  };

  if (isAuthenticated) {
    return null; // Silent when already authenticated
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-sm bg-dark-900 border border-slate-700/80 rounded-3xl p-6 shadow-2xl space-y-5">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-brand-500/10 border border-brand-500/30 flex items-center justify-center text-brand-400">
            <KeyRound className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-white tracking-tight">
            Pair with {serverInfo ? serverInfo.serverName : 'Windows PC'}
          </h2>
          <p className="text-xs text-slate-400">
            Enter the 6-digit PIN shown on your PC dashboard to unlock remote control.
          </p>
        </div>

        {authError && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-rose-300 text-xs">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{authError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Pairing PIN
            </label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={7}
              value={pin}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, '').slice(0, 6);
                if (digits.length > 3) {
                  setPin(`${digits.slice(0, 3)} ${digits.slice(3)}`);
                } else {
                  setPin(digits);
                }
              }}
              placeholder="e.g. 482 910"
              className="w-full py-3 px-4 text-center tracking-[0.3em] font-mono font-bold text-xl bg-dark-800 text-white border border-slate-700 rounded-2xl focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/30"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
              Device Name
            </label>
            <div className="relative">
              <input
                type="text"
                value={deviceLabel}
                onChange={(e) => setDeviceLabel(e.target.value)}
                maxLength={30}
                className="w-full py-2.5 px-3 pl-9 text-xs bg-dark-800 text-slate-200 border border-slate-700 rounded-xl focus:outline-none focus:border-brand-500"
              />
              <Smartphone className="w-4 h-4 text-slate-500 absolute left-3 top-3" />
            </div>
          </div>

          <button
            type="submit"
            disabled={pin.replace(/\D/g, '').length < 6 || isSubmitting}
            className="w-full py-3 px-4 rounded-2xl font-bold text-xs bg-gradient-to-r from-brand-600 to-cyan-500 hover:from-brand-500 hover:to-cyan-400 active:scale-95 text-white shadow-lg shadow-brand-500/30 border border-brand-400/30 transition-all disabled:opacity-40 disabled:pointer-events-none"
          >
            {isSubmitting ? 'Verifying PIN...' : 'Pair Device & Connect'}
          </button>
        </form>

        <div className="pt-2 border-t border-slate-800 text-center">
          <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Cryptographic token stored locally on this phone
          </p>
        </div>
      </div>
    </div>
  );
};

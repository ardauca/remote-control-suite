import React from 'react';
import { LucideIcon } from 'lucide-react';

interface FeaturePlaceholderProps {
  title: string;
  phase: string;
  description: string;
  icon: LucideIcon;
}

export const FeaturePlaceholder: React.FC<FeaturePlaceholderProps> = ({
  title,
  phase,
  description,
  icon: Icon
}) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center max-w-sm mx-auto">
      <div className="p-4 bg-dark-800 rounded-3xl border border-slate-800 shadow-xl mb-4 text-brand-500">
        <Icon className="w-10 h-10" />
      </div>
      <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide uppercase bg-brand-500/10 text-brand-400 border border-brand-500/20 mb-2">
        {phase}
      </span>
      <h3 className="text-lg font-bold text-white mb-2">{title}</h3>
      <p className="text-xs text-slate-400 leading-relaxed mb-6">
        {description}
      </p>
      <div className="w-full bg-dark-800/60 rounded-xl p-3 border border-slate-800/80 text-[11px] text-slate-400">
        Architecture layer ready. This module will be activated in the next development phase.
      </div>
    </div>
  );
};

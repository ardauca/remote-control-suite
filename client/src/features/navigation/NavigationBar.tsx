import React from 'react';
import { Home, MousePointer, Monitor, PlaySquare, Power } from 'lucide-react';

export type TabType = 'home' | 'remote' | 'screen' | 'media' | 'more';

interface NavigationBarProps {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}

export const NavigationBar: React.FC<NavigationBarProps> = ({ activeTab, onTabChange }) => {
  const tabs = [
    { id: 'home' as TabType, label: 'Home', icon: Home },
    { id: 'remote' as TabType, label: 'Touchpad', icon: MousePointer },
    { id: 'screen' as TabType, label: 'Screen', icon: Monitor },
    { id: 'media' as TabType, label: 'Media', icon: PlaySquare },
    { id: 'more' as TabType, label: 'Power', icon: Power },
  ];

  const handleSelectTab = (id: TabType) => {
    if ('vibrate' in navigator) {
      navigator.vibrate(8);
    }
    onTabChange(id);
  };

  return (
    <nav className="shrink-0 bg-dark-900/95 backdrop-blur-2xl border-t border-slate-800/80 safe-bottom z-30" aria-label="Main Navigation">
      <div className="flex items-center justify-around px-2 py-1.5 max-w-md mx-auto">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleSelectTab(tab.id)}
              aria-label={tab.label}
              aria-selected={isActive}
              role="tab"
              className={`flex flex-col items-center justify-center w-16 py-1 px-1 rounded-2xl transition-all duration-150 active:scale-95 ${
                isActive
                  ? 'text-brand-400 font-semibold bg-brand-500/15 shadow-sm shadow-brand-500/10 border border-brand-500/25'
                  : 'text-slate-400 hover:text-slate-200 font-normal hover:bg-slate-800/40'
              }`}
            >
              <Icon className={`w-5 h-5 mb-0.5 transition-transform ${isActive ? 'scale-110 text-brand-400' : ''}`} />
              <span className="text-[10px] tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

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
    { id: 'remote' as TabType, label: 'Remote', icon: MousePointer },
    { id: 'screen' as TabType, label: 'Screen', icon: Monitor },
    { id: 'media' as TabType, label: 'Media', icon: PlaySquare },
    { id: 'more' as TabType, label: 'Power', icon: Power },
  ];

  return (
    <nav className="shrink-0 bg-dark-800/90 backdrop-blur-xl border-t border-slate-800/80 safe-bottom">
      <div className="flex items-center justify-around px-2 py-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex flex-col items-center justify-center w-16 py-1.5 rounded-xl transition-all duration-200 active:scale-90 ${
                isActive
                  ? 'text-brand-500 font-semibold'
                  : 'text-slate-400 hover:text-slate-200 font-normal'
              }`}
            >
              <Icon className={`w-5 h-5 mb-1 transition-transform ${isActive ? 'scale-110' : ''}`} />
              <span className="text-[10px] tracking-tight">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};

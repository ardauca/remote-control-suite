import React, { useState, useRef, useEffect } from 'react';
import { wsClient } from '../../protocol/wsClient';
import { 
  DEFAULT_SHORTCUTS, 
  MacroManager, 
  ShortcutDefinition 
} from './MacroManager';
import { 
  Send, 
  Delete, 
  CornerDownLeft, 
  ArrowLeft, 
  ArrowRight, 
  ArrowUp, 
  ArrowDown, 
  Plus, 
  Trash2, 
  ChevronDown, 
  ChevronUp, 
  RotateCcw,
  Zap
} from 'lucide-react';

type ModifierState = 'IDLE' | 'STICKY' | 'LOCKED';

export const KeyboardControlBar: React.FC = () => {
  const [textInput, setTextInput] = useState('');
  const [modifiers, setModifiers] = useState<Record<string, ModifierState>>({
    CTRL: 'IDLE',
    ALT: 'IDLE',
    SHIFT: 'IDLE',
    WIN: 'IDLE'
  });

  const [customShortcuts, setCustomShortcuts] = useState<ShortcutDefinition[]>(() => {
    return MacroManager.getCustomShortcuts();
  });

  const [showFKeys, setShowFKeys] = useState(false);
  const [showAddShortcut, setShowAddShortcut] = useState(false);
  const [newShortcutName, setNewShortcutName] = useState('');
  const [newShortcutKey, setNewShortcutKey] = useState('S');
  const [newShortcutModifiers, setNewShortcutModifiers] = useState<string[]>(['CTRL']);

  const inputRef = useRef<HTMLInputElement>(null);

  // Auto release modifiers on cleanup or disconnect
  useEffect(() => {
    return () => {
      wsClient.send('command', 'keyboard.releaseAll', {});
    };
  }, []);

  // Cycle modifier state: IDLE -> STICKY -> LOCKED -> IDLE
  const toggleModifier = (mod: string) => {
    const currentState = modifiers[mod];
    let nextState: ModifierState = 'IDLE';

    if (currentState === 'IDLE') {
      nextState = 'STICKY';
      wsClient.send('command', 'keyboard.keyDown', { key: mod });
    } else if (currentState === 'STICKY') {
      nextState = 'LOCKED';
      // Already down
    } else {
      nextState = 'IDLE';
      wsClient.send('command', 'keyboard.keyUp', { key: mod });
    }

    setModifiers((prev) => ({ ...prev, [mod]: nextState }));
  };

  // Helper to auto-release any STICKY modifiers after an action
  const releaseStickyModifiers = () => {
    const updated = { ...modifiers };
    let changed = false;

    Object.entries(modifiers).forEach(([mod, state]) => {
      if (state === 'STICKY') {
        wsClient.send('command', 'keyboard.keyUp', { key: mod });
        updated[mod] = 'IDLE';
        changed = true;
      }
    });

    if (changed) {
      setModifiers(updated);
    }
  };

  // Release all keys panic button
  const handleReleaseAll = () => {
    wsClient.send('command', 'keyboard.releaseAll', {});
    setModifiers({
      CTRL: 'IDLE',
      ALT: 'IDLE',
      SHIFT: 'IDLE',
      WIN: 'IDLE'
    });
  };

  // Send single special key (e.g. ENTER, ESC, TAB, ARROWS)
  const sendSpecialKey = (key: string) => {
    wsClient.send('command', 'keyboard.keyDown', { key });
    setTimeout(() => {
      wsClient.send('command', 'keyboard.keyUp', { key });
      releaseStickyModifiers();
    }, 20);
  };

  // Direct Native Text Typing
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;

    // Send the typed character(s) directly as Unicode text to Windows
    wsClient.send('command', 'keyboard.text', { text: val });
    releaseStickyModifiers();

    // Immediately clear field to prevent character accumulation and duplicate issues
    setTextInput('');
  };

  // Handle hardware/iOS Backspace or Enter when input text is empty
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      e.preventDefault();
      sendSpecialKey('BACKSPACE');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      sendSpecialKey('ENTER');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      sendSpecialKey('TAB');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      sendSpecialKey('ESC');
    }
  };

  // Execute quick shortcut
  const handleShortcut = (keys: string[]) => {
    // If any modifier is active, merge them
    const activeMods = Object.entries(modifiers)
      .filter(([_, state]) => state !== 'IDLE')
      .map(([mod]) => mod);

    const mergedKeys = Array.from(new Set([...activeMods, ...keys]));
    MacroManager.executeShortcut(mergedKeys);
    releaseStickyModifiers();
  };

  // Save new custom shortcut
  const handleSaveCustom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShortcutName.trim() || !newShortcutKey.trim()) return;

    const allKeys = [...newShortcutModifiers, newShortcutKey.toUpperCase().trim()];
    const created = MacroManager.saveCustomShortcut(newShortcutName.trim(), allKeys);
    setCustomShortcuts([...customShortcuts, created]);

    setNewShortcutName('');
    setShowAddShortcut(false);
  };

  const handleDeleteCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    MacroManager.deleteCustomShortcut(id);
    setCustomShortcuts(customShortcuts.filter(s => s.id !== id));
  };

  return (
    <div className="flex flex-col w-full space-y-3 p-1 select-none">
      {/* 1. Native iOS Keyboard Input Box */}
      <div className="bg-dark-800/90 rounded-2xl p-2.5 border border-slate-700/80 shadow-lg flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={textInput}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          enterKeyHint="send"
          placeholder="Tap here to type on PC (Turkish / Emoji supported)..."
          className="flex-1 bg-dark-900/90 text-white placeholder-slate-500 text-xs px-3.5 py-2.5 rounded-xl border border-slate-700 focus:outline-none focus:border-brand-500 font-sans"
        />
        <button
          onClick={() => {
            if (textInput) {
              wsClient.send('command', 'keyboard.text', { text: textInput });
              setTextInput('');
              releaseStickyModifiers();
            }
          }}
          className="p-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white shadow-md shadow-brand-500/20 active:scale-95 transition-all"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Modifiers Bar (Ctrl, Alt, Shift, Win) + Safety Panic Button */}
      <div className="grid grid-cols-5 gap-1.5">
        {(['CTRL', 'ALT', 'SHIFT', 'WIN'] as const).map((mod) => {
          const state = modifiers[mod];
          const isSticky = state === 'STICKY';
          const isLocked = state === 'LOCKED';

          return (
            <button
              key={mod}
              onClick={() => toggleModifier(mod)}
              className={`py-2 px-1 rounded-xl text-xs font-bold transition-all border flex flex-col items-center justify-center active:scale-95 ${
                isLocked
                  ? 'bg-rose-500/20 text-rose-400 border-rose-500/60 shadow-lg shadow-rose-500/20'
                  : isSticky
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 shadow-lg shadow-amber-500/20 animate-pulse'
                  : 'bg-dark-800 text-slate-300 border-slate-700/80 hover:bg-slate-700'
              }`}
            >
              <span>{mod}</span>
              <span className="text-[8px] font-normal opacity-70">
                {isLocked ? 'LOCKED' : isSticky ? 'ONCE' : 'OFF'}
              </span>
            </button>
          );
        })}

        {/* Release All Panic Button */}
        <button
          onClick={handleReleaseAll}
          title="Release all held keys"
          className="py-2 px-1 rounded-xl text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700 hover:text-rose-400 flex flex-col items-center justify-center active:scale-95"
        >
          <RotateCcw className="w-3.5 h-3.5 mb-0.5" />
          <span className="text-[8px] font-normal">RESET</span>
        </button>
      </div>

      {/* 3. Primary Navigation & Editing Keys */}
      <div className="grid grid-cols-6 gap-1.5">
        <button
          onClick={() => sendSpecialKey('ESC')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 active:bg-dark-700"
        >
          Esc
        </button>
        <button
          onClick={() => sendSpecialKey('TAB')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 active:bg-dark-700"
        >
          Tab
        </button>
        <button
          onClick={() => sendSpecialKey('BACKSPACE')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 active:bg-dark-700 flex items-center justify-center"
        >
          <Delete className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendSpecialKey('ENTER')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-emerald-400 border border-emerald-500/30 active:bg-dark-700 flex items-center justify-center"
        >
          <CornerDownLeft className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => sendSpecialKey('DELETE')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-rose-400 border border-slate-700/80 active:bg-dark-700"
        >
          Del
        </button>
        <button
          onClick={() => sendSpecialKey('SPACE')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 active:bg-dark-700"
        >
          Space
        </button>
      </div>

      {/* 4. Directional Arrows */}
      <div className="grid grid-cols-4 gap-1.5">
        <button
          onClick={() => sendSpecialKey('LEFT')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 flex items-center justify-center active:bg-dark-700"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <button
          onClick={() => sendSpecialKey('UP')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 flex items-center justify-center active:bg-dark-700"
        >
          <ArrowUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => sendSpecialKey('DOWN')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 flex items-center justify-center active:bg-dark-700"
        >
          <ArrowDown className="w-4 h-4" />
        </button>
        <button
          onClick={() => sendSpecialKey('RIGHT')}
          className="py-2 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 flex items-center justify-center active:bg-dark-700"
        >
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>

      {/* 5. Function Keys F1-F12 (Expandable) */}
      <div className="bg-dark-800/60 rounded-2xl border border-slate-800 overflow-hidden">
        <button
          onClick={() => setShowFKeys(!showFKeys)}
          className="w-full px-3 py-2 text-[11px] font-semibold text-slate-400 hover:text-slate-200 flex items-center justify-between"
        >
          <span>Function Keys (F1 - F12)</span>
          {showFKeys ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {showFKeys && (
          <div className="p-2 border-t border-slate-800 grid grid-cols-6 gap-1">
            {Array.from({ length: 12 }, (_, i) => `F${i + 1}`).map((fKey) => (
              <button
                key={fKey}
                onClick={() => sendSpecialKey(fKey)}
                className="py-1.5 rounded-lg text-xs font-mono bg-dark-900 text-cyan-300 border border-slate-700/60 hover:bg-dark-700 active:scale-95"
              >
                {fKey}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 6. Quick Windows Shortcuts */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400 uppercase tracking-wider px-1">
          <span className="flex items-center gap-1">
            <Zap className="w-3 h-3 text-amber-400" />
            Quick Shortcuts
          </span>
          <button
            onClick={() => setShowAddShortcut(!showAddShortcut)}
            className="text-brand-400 hover:text-brand-300 flex items-center gap-1 font-normal lowercase text-[10px]"
          >
            <Plus className="w-3 h-3" />
            add custom
          </button>
        </div>

        {/* Custom Shortcut Creator */}
        {showAddShortcut && (
          <form onSubmit={handleSaveCustom} className="bg-dark-800 rounded-2xl p-3 border border-slate-700 space-y-2.5 animate-fadeIn">
            <div className="text-xs font-semibold text-slate-200">Create Custom Shortcut</div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Shortcut Name (e.g. Save As)"
                value={newShortcutName}
                onChange={(e) => setNewShortcutName(e.target.value)}
                className="flex-1 bg-dark-900 text-white text-xs px-3 py-2 rounded-xl border border-slate-700"
              />
              <input
                type="text"
                placeholder="Key (S)"
                maxLength={5}
                value={newShortcutKey}
                onChange={(e) => setNewShortcutKey(e.target.value)}
                className="w-16 bg-dark-900 text-white text-xs px-2 py-2 rounded-xl border border-slate-700 text-center font-mono uppercase"
              />
            </div>
            <div className="flex items-center gap-2">
              {(['CTRL', 'ALT', 'SHIFT', 'WIN'] as const).map((m) => {
                const checked = newShortcutModifiers.includes(m);
                return (
                  <button
                    type="button"
                    key={m}
                    onClick={() => {
                      if (checked) {
                        setNewShortcutModifiers(newShortcutModifiers.filter((x) => x !== m));
                      } else {
                        setNewShortcutModifiers([...newShortcutModifiers, m]);
                      }
                    }}
                    className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors ${
                      checked
                        ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                        : 'bg-dark-900 text-slate-400 border-slate-700'
                    }`}
                  >
                    {m}
                  </button>
                );
              })}
              <button
                type="submit"
                className="ml-auto px-3 py-1 bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold rounded-xl"
              >
                Save
              </button>
            </div>
          </form>
        )}

        <div className="grid grid-cols-4 gap-1.5">
          {DEFAULT_SHORTCUTS.map((s) => (
            <button
              key={s.id}
              onClick={() => handleShortcut(s.keys)}
              className="py-2 px-1 rounded-xl text-xs font-medium bg-dark-800 hover:bg-dark-700 active:bg-brand-500/20 text-slate-200 border border-slate-700/80 active:scale-95 transition-all text-center truncate"
            >
              {s.name}
            </button>
          ))}

          {/* User Custom Shortcuts */}
          {customShortcuts.map((cs) => (
            <div key={cs.id} className="relative group">
              <button
                onClick={() => handleShortcut(cs.keys)}
                className="w-full py-2 px-1 rounded-xl text-xs font-medium bg-cyan-950/40 hover:bg-cyan-900/50 active:bg-cyan-500/30 text-cyan-200 border border-cyan-800/60 active:scale-95 transition-all text-center truncate"
              >
                {cs.name}
              </button>
              <button
                onClick={(e) => handleDeleteCustom(cs.id, e)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 text-white rounded-full flex items-center justify-center text-[10px] opacity-80 hover:opacity-100 shadow"
              >
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

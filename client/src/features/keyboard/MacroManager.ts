import { wsClient } from '../../protocol/wsClient';

export interface ShortcutDefinition {
  id: string;
  name: string;
  keys: string[];
  category: 'system' | 'edit' | 'window' | 'custom';
}

export interface MacroAction {
  type: 'keyDown' | 'keyUp' | 'text' | 'delay' | 'shortcut';
  key?: string;
  text?: string;
  durationMs?: number;
  keys?: string[];
}

export interface MacroDefinition {
  id: string;
  name: string;
  actions: MacroAction[];
}

export const DEFAULT_SHORTCUTS: ShortcutDefinition[] = [
  // Edit
  { id: 'copy', name: 'Ctrl + C', keys: ['CTRL', 'C'], category: 'edit' },
  { id: 'paste', name: 'Ctrl + V', keys: ['CTRL', 'V'], category: 'edit' },
  { id: 'cut', name: 'Ctrl + X', keys: ['CTRL', 'X'], category: 'edit' },
  { id: 'undo', name: 'Ctrl + Z', keys: ['CTRL', 'Z'], category: 'edit' },
  { id: 'redo', name: 'Ctrl + Y', keys: ['CTRL', 'Y'], category: 'edit' },
  { id: 'selectAll', name: 'Ctrl + A', keys: ['CTRL', 'A'], category: 'edit' },
  { id: 'save', name: 'Ctrl + S', keys: ['CTRL', 'S'], category: 'edit' },
  { id: 'find', name: 'Ctrl + F', keys: ['CTRL', 'F'], category: 'edit' },

  // Window & System
  { id: 'altTab', name: 'Alt + Tab', keys: ['ALT', 'TAB'], category: 'window' },
  { id: 'closeWindow', name: 'Alt + F4', keys: ['ALT', 'F4'], category: 'window' },
  { id: 'closeTab', name: 'Ctrl + W', keys: ['CTRL', 'W'], category: 'window' },
  { id: 'taskManager', name: 'Task Manager', keys: ['CTRL', 'SHIFT', 'ESC'], category: 'system' },
  { id: 'showDesktop', name: 'Show Desktop', keys: ['WIN', 'D'], category: 'system' },
  { id: 'fileExplorer', name: 'File Explorer', keys: ['WIN', 'E'], category: 'system' },
  { id: 'lockPc', name: 'Lock Workstation', keys: ['WIN', 'L'], category: 'system' },
  { id: 'runDialog', name: 'Run Dialog', keys: ['WIN', 'R'], category: 'system' },
];

export class MacroManager {
  private static CUSTOM_STORAGE_KEY = 'remote_custom_shortcuts';

  public static getCustomShortcuts(): ShortcutDefinition[] {
    try {
      const data = localStorage.getItem(this.CUSTOM_STORAGE_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item): item is ShortcutDefinition =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        Array.isArray(item.keys) &&
        item.keys.length > 0 &&
        item.keys.every((k: unknown) => typeof k === 'string')
      );
    } catch {
      return [];
    }
  }

  public static saveCustomShortcut(name: string, keys: string[]): ShortcutDefinition {
    const list = this.getCustomShortcuts();
    const newShortcut: ShortcutDefinition = {
      id: 'custom_' + Date.now().toString(36),
      name: name.trim(),
      keys: keys.map(k => k.trim().toUpperCase()),
      category: 'custom'
    };
    list.push(newShortcut);
    localStorage.setItem(this.CUSTOM_STORAGE_KEY, JSON.stringify(list));
    return newShortcut;
  }

  public static deleteCustomShortcut(id: string): void {
    const list = this.getCustomShortcuts().filter(s => s.id !== id);
    localStorage.setItem(this.CUSTOM_STORAGE_KEY, JSON.stringify(list));
  }

  public static executeShortcut(keys: string[]): void {
    if (!keys || keys.length === 0) return;
    const cleanKeys = keys.map(k => k.trim().toUpperCase());
    wsClient.send('command', 'keyboard.shortcut', { keys: cleanKeys });
  }

  public static async executeMacro(actions: MacroAction[]): Promise<void> {
    try {
      for (const action of actions) {
        switch (action.type) {
          case 'keyDown':
            if (action.key) {
              wsClient.send('command', 'keyboard.keyDown', { key: action.key.trim().toUpperCase() });
            }
            break;
          case 'keyUp':
            if (action.key) {
              wsClient.send('command', 'keyboard.keyUp', { key: action.key.trim().toUpperCase() });
            }
            break;
          case 'text':
            if (action.text) {
              wsClient.send('command', 'keyboard.text', { text: action.text });
            }
            break;
          case 'shortcut':
            if (action.keys && action.keys.length > 0) {
              this.executeShortcut(action.keys);
            }
            break;
          case 'delay':
            await new Promise(r => setTimeout(r, action.durationMs || 50));
            break;
        }
      }
    } catch (err) {
      console.error('Error executing macro, releasing keys as safety measure:', err);
      wsClient.send('command', 'keyboard.releaseAll', {});
      throw err;
    }
  }
}

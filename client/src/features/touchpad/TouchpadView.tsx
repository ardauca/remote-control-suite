import React, { useEffect, useRef, useState, useCallback } from 'react';
import { wsClient } from '../../protocol/wsClient';
import { KeyboardControlBar } from '../keyboard/KeyboardControlBar';
import { 
  Sliders, 
  Move, 
  MousePointerClick,
  MousePointer,
  Keyboard
} from 'lucide-react';

export const TouchpadView: React.FC = () => {
  const touchpadRef = useRef<HTMLDivElement>(null);

  // Mode: Touchpad or Keyboard
  const [activeMode, setActiveMode] = useState<'touchpad' | 'keyboard'>('touchpad');

  // Settings State
  const [sensitivity, setSensitivity] = useState<number>(() => {
    return parseFloat(localStorage.getItem('touchpad_sensitivity') || '1.4');
  });
  const [acceleration, setAcceleration] = useState<boolean>(() => {
    return localStorage.getItem('touchpad_acceleration') !== 'false';
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isDragLocked, setIsDragLocked] = useState<boolean>(false);
  const [eventCount, setEventCount] = useState<number>(0);
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null);

  // High performance mutable tracking refs
  const stateRef = useRef({
    activePointers: new Map<number, { x: number; y: number }>(),
    startTime: 0,
    hasMoved: false,
    lastX: 0,
    lastY: 0,
    scrollAccumulator: 0,
    sensitivity: 1.4,
    acceleration: true
  });

  // Keep ref values in sync with state
  useEffect(() => {
    stateRef.current.sensitivity = sensitivity;
    stateRef.current.acceleration = acceleration;
  }, [sensitivity, acceleration]);

  const toggleDragLock = () => {
    const newState = !isDragLocked;
    setIsDragLocked(newState);
    if (newState) {
      wsClient.send('command', 'mouse.down', { button: 'left' });
    } else {
      wsClient.send('command', 'mouse.up', { button: 'left' });
    }
  };

  const handleButtonClick = (button: 'left' | 'right' | 'middle', double = false) => {
    wsClient.send('command', 'mouse.click', { button, double });
    setEventCount((c) => c + 1);
  };

  // Pointer Down
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if not supported
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    stateRef.current.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    stateRef.current.startTime = Date.now();
    stateRef.current.hasMoved = false;
    stateRef.current.lastX = e.clientX;
    stateRef.current.lastY = e.clientY;
    stateRef.current.scrollAccumulator = 0;

    setTouchPos({ x: relX, y: relY });
  }, []);

  const pendingDxRef = useRef(0);
  const pendingDyRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);

  const flushMouseMove = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    const sendDx = Math.round(pendingDxRef.current);
    const sendDy = Math.round(pendingDyRef.current);
    pendingDxRef.current = 0;
    pendingDyRef.current = 0;

    if (sendDx !== 0 || sendDy !== 0) {
      wsClient.send('command', 'mouse.move', { dx: sendDx, dy: sendDy });
      setEventCount((c) => c + 1);
    }
  }, []);

  // Pointer Move
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!stateRef.current.activePointers.has(e.pointerId)) return;

    const pointers = stateRef.current.activePointers;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const rect = e.currentTarget.getBoundingClientRect();
    setTouchPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });

    // 1 Finger -> Mouse Movement (Coalesced via requestAnimationFrame)
    if (pointers.size === 1) {
      const dxRaw = e.clientX - stateRef.current.lastX;
      const dyRaw = e.clientY - stateRef.current.lastY;

      if (Math.abs(dxRaw) > 0.3 || Math.abs(dyRaw) > 0.3) {
        stateRef.current.hasMoved = true;

        let dx = dxRaw * stateRef.current.sensitivity;
        let dy = dyRaw * stateRef.current.sensitivity;

        if (stateRef.current.acceleration) {
          const speed = Math.hypot(dxRaw, dyRaw);
          const mult = Math.min(Math.max(speed / 4, 1.0), 2.5);
          dx *= mult;
          dy *= mult;
        }

        pendingDxRef.current += dx;
        pendingDyRef.current += dy;

        if (rafIdRef.current === null) {
          rafIdRef.current = requestAnimationFrame(() => {
            rafIdRef.current = null;
            const sendDx = Math.round(pendingDxRef.current);
            const sendDy = Math.round(pendingDyRef.current);
            pendingDxRef.current = 0;
            pendingDyRef.current = 0;

            if (sendDx !== 0 || sendDy !== 0) {
              wsClient.send('command', 'mouse.move', { dx: sendDx, dy: sendDy });
              setEventCount((c) => c + 1);
            }
          });
        }
      }

      stateRef.current.lastX = e.clientX;
      stateRef.current.lastY = e.clientY;
    }
    // 2 Fingers -> Scrolling
    else if (pointers.size === 2) {
      const pArray = Array.from(pointers.values());
      const currentY = (pArray[0].y + pArray[1].y) / 2;
      const dyRaw = currentY - stateRef.current.lastY;

      stateRef.current.hasMoved = true;
      stateRef.current.scrollAccumulator += dyRaw;

      const threshold = 12;
      if (Math.abs(stateRef.current.scrollAccumulator) >= threshold) {
        const steps = Math.trunc(stateRef.current.scrollAccumulator / threshold);
        stateRef.current.scrollAccumulator -= steps * threshold;

        wsClient.send('command', 'mouse.scroll', { dx: 0, dy: steps });
        setEventCount((c) => c + 1);
      }

      stateRef.current.lastY = currentY;
    }
  }, []);

  // Pointer Up
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const countBeforeRemove = stateRef.current.activePointers.size;
    stateRef.current.activePointers.delete(e.pointerId);

    const elapsed = Date.now() - stateRef.current.startTime;

    // Tap detection (Quick tap without dragging)
    if (!stateRef.current.hasMoved && elapsed < 300) {
      if (countBeforeRemove === 1) {
        // Single tap -> Left Click
        wsClient.send('command', 'mouse.click', { button: 'left' });
        setEventCount((c) => c + 1);
      } else if (countBeforeRemove === 2) {
        // Two finger tap -> Right Click
        wsClient.send('command', 'mouse.click', { button: 'right' });
        setEventCount((c) => c + 1);
      }
    }

    // Flush any pending coalesced movement
    flushMouseMove();

    if (stateRef.current.activePointers.size === 0) {
      setTouchPos(null);
    }
  }, [flushMouseMove]);

  return (
    <div className="flex flex-col h-full w-full select-none overflow-hidden space-y-2">
      {/* Mode Switcher: Touchpad vs Keyboard */}
      <div className="flex bg-dark-950 p-1 rounded-2xl border border-slate-800 shrink-0">
        <button
          onClick={() => setActiveMode('touchpad')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'touchpad'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <MousePointer className="w-3.5 h-3.5" />
          Touchpad
        </button>
        <button
          onClick={() => setActiveMode('keyboard')}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all ${
            activeMode === 'keyboard'
              ? 'bg-brand-500 text-white shadow-md shadow-brand-500/25'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Keyboard className="w-3.5 h-3.5" />
          Keyboard & Shortcuts
        </button>
      </div>

      {/* KEYBOARD VIEW */}
      {activeMode === 'keyboard' ? (
        <div className="flex-1 overflow-y-auto pr-0.5">
          <KeyboardControlBar />
        </div>
      ) : (
        /* TOUCHPAD VIEW */
        <div className="flex-1 flex flex-col overflow-hidden space-y-2">
          {/* Top Status & Controls Header */}
          <div className="flex items-center justify-between px-1 shrink-0">
            <div className="flex items-center gap-2">
              <button
                onClick={toggleDragLock}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  isDragLocked 
                    ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/30' 
                    : 'bg-dark-800 text-slate-300 border border-slate-700/80 hover:bg-slate-700'
                }`}
              >
                <Move className="w-3.5 h-3.5" />
                {isDragLocked ? 'Drag Locked (ON)' : 'Drag Lock'}
              </button>

              <button
                onClick={() => handleButtonClick('left', true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-dark-800 text-slate-300 border border-slate-700/80 hover:bg-slate-700 flex items-center gap-1.5"
              >
                <MousePointerClick className="w-3.5 h-3.5 text-brand-400" />
                Double Click
              </button>
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono text-slate-400 bg-dark-800/80 px-2 py-1 rounded-lg border border-slate-800">
                Sent: {eventCount}
              </span>

              <button
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2 rounded-xl text-xs border transition-colors ${
                  showSettings 
                    ? 'bg-brand-500/20 text-brand-400 border-brand-500/40' 
                    : 'bg-dark-800 text-slate-400 border-slate-700 hover:text-white'
                }`}
                title="Touchpad Settings"
              >
                <Sliders className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Settings Drawer (Expandable) */}
          {showSettings && (
            <div className="bg-dark-800/95 backdrop-blur-md rounded-2xl p-4 border border-slate-700/80 space-y-3.5 shrink-0 animate-fadeIn">
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300">
                <span>Pointer Sensitivity ({sensitivity.toFixed(1)}x)</span>
                <input
                  type="range"
                  min="0.5"
                  max="3.5"
                  step="0.1"
                  value={sensitivity}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setSensitivity(val);
                    localStorage.setItem('touchpad_sensitivity', val.toString());
                  }}
                  className="w-32 accent-brand-500"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-300">
                <span>Cursor Acceleration</span>
                <input
                  type="checkbox"
                  checked={acceleration}
                  onChange={(e) => {
                    setAcceleration(e.target.checked);
                    localStorage.setItem('touchpad_acceleration', e.target.checked.toString());
                  }}
                  className="accent-brand-500 w-4 h-4 rounded"
                />
              </div>

              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-700/50 flex justify-between">
                <span>• 1 finger move: Cursor</span>
                <span>• 2 finger scroll: Scroll wheel</span>
              </div>
            </div>
          )}

          {/* Main Touchpad Surface */}
          <div
            ref={touchpadRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            style={{ touchAction: 'none' }}
            className="flex-1 w-full bg-dark-800/80 active:bg-dark-800 rounded-3xl border border-slate-700/80 shadow-2xl flex flex-col items-center justify-center relative touch-none select-none overflow-hidden cursor-crosshair"
          >
            {/* Visual Touch Tracker Indicator */}
            {touchPos && (
              <div
                className="absolute w-12 h-12 rounded-full border-2 border-brand-400/80 bg-brand-500/20 pointer-events-none -translate-x-1/2 -translate-y-1/2 transition-transform duration-75 ease-out shadow-lg shadow-brand-500/30"
                style={{ left: touchPos.x, top: touchPos.y }}
              />
            )}

            {/* Center Guide Label */}
            <div className="text-center pointer-events-none opacity-40 select-none">
              <p className="text-sm font-semibold text-slate-300 tracking-wide">TOUCHPAD</p>
              <p className="text-[11px] text-slate-400 mt-1">1 finger to move • Tap to click</p>
              <p className="text-[10px] text-slate-500 mt-0.5">2 fingers to scroll & right click</p>
            </div>

            {isDragLocked && (
              <div className="absolute top-4 px-3.5 py-1.5 bg-rose-500 text-white text-xs font-bold rounded-full animate-pulse shadow-lg pointer-events-none">
                DRAG LOCKED - TAP DRAG LOCK TO RELEASE
              </div>
            )}
          </div>

          {/* Bottom Physical Mouse Buttons */}
          <div className="h-16 w-full grid grid-cols-2 gap-2 pt-1 shrink-0">
            <button
              onClick={() => handleButtonClick('left')}
              className="h-full bg-dark-800 hover:bg-dark-700 active:bg-brand-500/20 active:border-brand-500/60 text-slate-200 active:text-brand-300 rounded-2xl border border-slate-700/70 font-semibold text-sm transition-all shadow-md active:scale-[0.98] flex items-center justify-center"
            >
              Left Click
            </button>

            <button
              onClick={() => handleButtonClick('right')}
              className="h-full bg-dark-800 hover:bg-dark-700 active:bg-brand-500/20 active:border-brand-500/60 text-slate-200 active:text-brand-300 rounded-2xl border border-slate-700/70 font-semibold text-sm transition-all shadow-md active:scale-[0.98] flex items-center justify-center"
            >
              Right Click
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

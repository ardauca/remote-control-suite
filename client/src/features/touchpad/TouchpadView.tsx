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

interface PointerInfo {
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  isEdgeScroll: boolean;
}

export const TouchpadView: React.FC = () => {
  const touchpadRef = useRef<HTMLDivElement>(null);
  const touchTrackerRef = useRef<HTMLDivElement>(null);
  const padRectRef = useRef<{ left: number; top: number; width: number; height: number }>({ left: 0, top: 0, width: 0, height: 0 });

  // Mode: Touchpad or Keyboard
  const [activeMode, setActiveMode] = useState<'touchpad' | 'keyboard'>('touchpad');

  // Settings State (persisted in localStorage)
  const [sensitivity, setSensitivity] = useState<number>(() => {
    return parseFloat(localStorage.getItem('touchpad_sensitivity') || '1.4');
  });
  const [acceleration, setAcceleration] = useState<boolean>(() => {
    return localStorage.getItem('touchpad_acceleration') !== 'false';
  });
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [isDragLocked, setIsDragLocked] = useState<boolean>(false);

  // Physical mouse button holding states
  const [isLeftHeld, setIsLeftHeld] = useState<boolean>(false);
  const isLeftHeldRef = useRef<boolean>(false);

  const [isRightHeld, setIsRightHeld] = useState<boolean>(false);
  const isRightHeldRef = useRef<boolean>(false);

  // High performance mutable tracking refs (Zero React Re-renders during movement)
  const stateRef = useRef({
    activePointers: new Map<number, PointerInfo>(),
    startTime: 0,
    hasMoved: false,
    lastTwoFingerY: 0,
    scrollAccumulator: 0,
    edgeScrollAccumulator: 0,
    sensitivity: 1.4,
    acceleration: true
  });

  const pendingDxRef = useRef<number>(0);
  const pendingDyRef = useRef<number>(0);

  // Tap & Double Tap tracking refs
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const tapTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep ref values in sync with state
  useEffect(() => {
    stateRef.current.sensitivity = sensitivity;
    stateRef.current.acceleration = acceleration;
  }, [sensitivity, acceleration]);

  // Safety release on unmount, blur, pointercancel, or tab switch
  useEffect(() => {
    const releaseSafety = () => {
      if (isLeftHeldRef.current) {
        isLeftHeldRef.current = false;
        setIsLeftHeld(false);
        wsClient.send('command', 'mouse.up', { button: 'left' });
      }
      if (isRightHeldRef.current) {
        isRightHeldRef.current = false;
        setIsRightHeld(false);
        wsClient.send('command', 'mouse.up', { button: 'right' });
      }
      if (tapTimeoutRef.current !== null) {
        clearTimeout(tapTimeoutRef.current);
        tapTimeoutRef.current = null;
      }
      lastTapRef.current = null;
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        releaseSafety();
      }
    };

    window.addEventListener('blur', releaseSafety);
    window.addEventListener('pointercancel', releaseSafety);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      releaseSafety();
      window.removeEventListener('blur', releaseSafety);
      window.removeEventListener('pointercancel', releaseSafety);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // Prevent Safari zoom/gesture defaults on touchpad surface
  useEffect(() => {
    const pad = touchpadRef.current;
    if (!pad) return;

    const preventGestures = (e: Event) => {
      e.preventDefault();
    };

    pad.addEventListener('gesturestart', preventGestures);
    pad.addEventListener('gesturechange', preventGestures);
    pad.addEventListener('gestureend', preventGestures);

    return () => {
      pad.removeEventListener('gesturestart', preventGestures);
      pad.removeEventListener('gesturechange', preventGestures);
      pad.removeEventListener('gestureend', preventGestures);
    };
  }, [activeMode]);

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
  };

  // Physical Left Mouse Button Hold Handlers (multi-touch drag support)
  const handleLeftDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if not supported
    }
    if (!isLeftHeldRef.current) {
      isLeftHeldRef.current = true;
      setIsLeftHeld(true);
      wsClient.send('command', 'mouse.down', { button: 'left' });
    }
  }, []);

  const handleLeftUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (isLeftHeldRef.current) {
      isLeftHeldRef.current = false;
      setIsLeftHeld(false);
      wsClient.send('command', 'mouse.up', { button: 'left' });
    }
  }, []);

  // Physical Right Mouse Button Hold Handlers
  const handleRightDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if not supported
    }
    if (!isRightHeldRef.current) {
      isRightHeldRef.current = true;
      setIsRightHeld(true);
      wsClient.send('command', 'mouse.down', { button: 'right' });
    }
  }, []);

  const handleRightUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    if (isRightHeldRef.current) {
      isRightHeldRef.current = false;
      setIsRightHeld(false);
      wsClient.send('command', 'mouse.up', { button: 'right' });
    }
  }, []);

  // Pointer Down on Touchpad Surface
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if not supported
    }

    // Cache rect geometry once on pointerdown to prevent forced reflow during continuous moves
    const rect = e.currentTarget.getBoundingClientRect();
    padRectRef.current = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };

    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    const width = rect.width;

    // Right Edge Scroll Zone: rightmost 10% (relX / width >= 0.90)
    const isRightEdge = width > 0 && (relX / width) >= 0.90;

    stateRef.current.activePointers.set(e.pointerId, {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      isEdgeScroll: isRightEdge
    });

    stateRef.current.startTime = Date.now();
    stateRef.current.hasMoved = false;
    stateRef.current.scrollAccumulator = 0;
    stateRef.current.edgeScrollAccumulator = 0;

    if (stateRef.current.activePointers.size === 2) {
      const pArray = Array.from(stateRef.current.activePointers.values());
      stateRef.current.lastTwoFingerY = (pArray[0].lastY + pArray[1].lastY) / 2;
    }

    // Update DOM touch tracker directly without triggering React re-renders
    if (touchTrackerRef.current) {
      touchTrackerRef.current.style.transform = `translate3d(${relX}px, ${relY}px, 0)`;
      touchTrackerRef.current.style.opacity = '1';
    }
  }, []);

  const flushMouseMove = useCallback(() => {
    const sendDx = Math.round(pendingDxRef.current);
    const sendDy = Math.round(pendingDyRef.current);
    pendingDxRef.current = 0;
    pendingDyRef.current = 0;

    if (sendDx !== 0 || sendDy !== 0) {
      wsClient.send('command', 'mouse.move', { dx: sendDx, dy: sendDy });
    }
  }, []);

  // Pointer Move on Touchpad Surface - High-Throughput Event Path
  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const ptr = stateRef.current.activePointers.get(e.pointerId);
    if (!ptr) return;

    const pointers = stateRef.current.activePointers;

    // Direct GPU DOM touch tracker update (Zero React Re-render, Zero Reflow)
    if (touchTrackerRef.current) {
      const relX = e.clientX - padRectRef.current.left;
      const relY = e.clientY - padRectRef.current.top;
      touchTrackerRef.current.style.transform = `translate3d(${relX}px, ${relY}px, 0)`;
    }

    // 1 Finger Interaction
    if (pointers.size === 1) {
      // Mode A: Right-Edge Dedicated Scroll Zone
      if (ptr.isEdgeScroll) {
        const dyRaw = e.clientY - ptr.lastY;
        ptr.lastY = e.clientY;
        ptr.lastX = e.clientX;

        if (Math.abs(dyRaw) > 0.3) {
          stateRef.current.hasMoved = true;
          // Up = Scroll UP (positive delta), Down = Scroll DOWN (negative delta)
          stateRef.current.edgeScrollAccumulator -= dyRaw;

          const threshold = 12; // 12px accumulator per notch
          if (Math.abs(stateRef.current.edgeScrollAccumulator) >= threshold) {
            const steps = Math.trunc(stateRef.current.edgeScrollAccumulator / threshold);
            stateRef.current.edgeScrollAccumulator -= steps * threshold;

            wsClient.send('command', 'mouse.scroll', { dx: 0, dy: steps });
          }
        }
        return;
      }

      // Mode B: Normal Mouse Cursor Movement (Zero-latency direct event pipeline)
      const dxRaw = e.clientX - ptr.lastX;
      const dyRaw = e.clientY - ptr.lastY;
      ptr.lastX = e.clientX;
      ptr.lastY = e.clientY;

      if (!stateRef.current.hasMoved) {
        const dist = Math.hypot(e.clientX - ptr.startX, e.clientY - ptr.startY);
        if (dist > 1.2) {
          stateRef.current.hasMoved = true;
          if (tapTimeoutRef.current !== null) {
            clearTimeout(tapTimeoutRef.current);
            tapTimeoutRef.current = null;
            lastTapRef.current = null;
          }
        }
      }

      if (stateRef.current.hasMoved) {
        let dx = dxRaw * stateRef.current.sensitivity;
        let dy = dyRaw * stateRef.current.sensitivity;

        if (stateRef.current.acceleration) {
          const speed = Math.hypot(dxRaw, dyRaw);
          const mult = Math.min(Math.max(speed / 4, 1.0), 2.5);
          dx *= mult;
          dy *= mult;
        }

        // Sub-pixel Accumulation & Remainder Retention:
        // NEVER zero out fractional remainders! Only subtract integer pixels sent.
        pendingDxRef.current += dx;
        pendingDyRef.current += dy;

        const sendDx = Math.trunc(pendingDxRef.current);
        const sendDy = Math.trunc(pendingDyRef.current);

        if (sendDx !== 0 || sendDy !== 0) {
          pendingDxRef.current -= sendDx; // Retain sub-pixel remainder for continuous flow
          pendingDyRef.current -= sendDy; // Retain sub-pixel remainder for continuous flow

          wsClient.send('command', 'mouse.move', { dx: sendDx, dy: sendDy });
        }
      }
    }
    // 2 Fingers -> Scrolling
    else if (pointers.size === 2) {
      ptr.lastX = e.clientX;
      ptr.lastY = e.clientY;

      const pArray = Array.from(pointers.values());
      const currentY = (pArray[0].lastY + pArray[1].lastY) / 2;
      const dyRaw = currentY - stateRef.current.lastTwoFingerY;

      stateRef.current.hasMoved = true;
      stateRef.current.scrollAccumulator += dyRaw;

      const threshold = 12;
      if (Math.abs(stateRef.current.scrollAccumulator) >= threshold) {
        const steps = Math.trunc(stateRef.current.scrollAccumulator / threshold);
        stateRef.current.scrollAccumulator -= steps * threshold;

        wsClient.send('command', 'mouse.scroll', { dx: 0, dy: steps });
      }

      stateRef.current.lastTwoFingerY = currentY;
    }
  }, []);

  // Pointer Up on Touchpad Surface
  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const countBeforeRemove = stateRef.current.activePointers.size;
    const ptr = stateRef.current.activePointers.get(e.pointerId);
    stateRef.current.activePointers.delete(e.pointerId);

    const elapsed = Date.now() - stateRef.current.startTime;
    const totalDist = ptr ? Math.hypot(e.clientX - ptr.startX, e.clientY - ptr.startY) : 999;

    // Tap detection on main touchpad surface (clean tap within 280ms & <8px total movement)
    if (!ptr?.isEdgeScroll && totalDist < 8 && elapsed < 280) {
      if (countBeforeRemove === 1) {
        // 1-Finger Tap candidate (Single or Double tap)
        const now = Date.now();
        const prevTap = lastTapRef.current;
        const isDoubleTap = 
          prevTap !== null &&
          (now - prevTap.time) < 320 &&
          Math.hypot(e.clientX - prevTap.x, e.clientY - prevTap.y) < 25;

        if (isDoubleTap) {
          // Double Tap Detected: cancel pending single click and send double click
          if (tapTimeoutRef.current !== null) {
            clearTimeout(tapTimeoutRef.current);
            tapTimeoutRef.current = null;
          }
          lastTapRef.current = null;

          wsClient.send('command', 'mouse.click', { button: 'left', double: true });
        } else {
          // 1st Tap: Record position & start timer to detect single vs double tap
          lastTapRef.current = { time: now, x: e.clientX, y: e.clientY };
          if (tapTimeoutRef.current !== null) {
            clearTimeout(tapTimeoutRef.current);
          }
          tapTimeoutRef.current = setTimeout(() => {
            tapTimeoutRef.current = null;
            lastTapRef.current = null;
            wsClient.send('command', 'mouse.click', { button: 'left', double: false });
          }, 190);
        }
      } else if (countBeforeRemove === 2) {
        // Two-Finger Tap -> Right Click immediately
        if (tapTimeoutRef.current !== null) {
          clearTimeout(tapTimeoutRef.current);
          tapTimeoutRef.current = null;
        }
        lastTapRef.current = null;
        wsClient.send('command', 'mouse.click', { button: 'right' });
      }
    }

    // Flush any pending sub-pixel movement
    flushMouseMove();

    if (stateRef.current.activePointers.size === 0 && touchTrackerRef.current) {
      touchTrackerRef.current.style.opacity = '0';
    }
  }, [flushMouseMove]);

  return (
    <div 
      className="flex flex-col h-full w-full select-none overflow-hidden space-y-2"
      style={{ touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none', overscrollBehavior: 'none' }}
    >
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

              <div className="text-[11px] text-slate-400 pt-1 border-t border-slate-700/50 flex flex-col gap-1">
                <div className="flex justify-between">
                  <span>• 1 finger move: Cursor</span>
                  <span>• Right edge: Scroll wheel</span>
                </div>
                <div className="flex justify-between">
                  <span>• Double tap: Double click</span>
                  <span>• Hold button + Pad: Drag</span>
                </div>
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
            style={{ 
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              overscrollBehavior: 'none'
            }}
            className="flex-1 w-full bg-dark-800/80 active:bg-dark-800 rounded-3xl border border-slate-700/80 shadow-2xl flex flex-col items-center justify-center relative touch-none select-none overflow-hidden cursor-crosshair"
          >
            {/* Direct GPU Hardware-Accelerated Touch Tracker Indicator (Zero React Re-render) */}
            <div
              ref={touchTrackerRef}
              className="absolute w-12 h-12 rounded-full border-2 border-brand-400/80 bg-brand-500/20 pointer-events-none -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-150 shadow-lg shadow-brand-500/30 will-change-transform"
              style={{ left: 0, top: 0, transform: 'translate3d(-9999px, -9999px, 0)' }}
            />

            {/* Right Edge Scroll Zone (Last 10% of width) */}
            <div 
              className="absolute right-0 top-0 bottom-0 w-[10%] min-w-[28px] max-w-[44px] pointer-events-none flex flex-col items-center justify-between py-5 border-l border-slate-700/30 bg-gradient-to-l from-slate-800/50 to-transparent"
            >
              <div className="w-1 h-3 rounded-full bg-slate-600/40" />
              <div className="flex flex-col items-center gap-1 select-none pointer-events-none">
                <span className="text-[8px] font-mono tracking-widest uppercase [writing-mode:vertical-lr] rotate-180 text-slate-500/60">
                  SCROLL
                </span>
              </div>
              <div className="w-1 h-3 rounded-full bg-slate-600/40" />
            </div>

            {/* Center Guide Label */}
            <div className="text-center pointer-events-none opacity-40 select-none px-6">
              <p className="text-sm font-semibold text-slate-300 tracking-wide">TOUCHPAD</p>
              <p className="text-[11px] text-slate-400 mt-1">1 finger to move • Double tap to open</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Hold Left Click to drag • Right edge to scroll</p>
            </div>

            {isDragLocked && (
              <div className="absolute top-4 px-3.5 py-1.5 bg-rose-500 text-white text-xs font-bold rounded-full animate-pulse shadow-lg pointer-events-none">
                DRAG LOCKED - TAP DRAG LOCK TO RELEASE
              </div>
            )}
          </div>

          {/* Bottom Physical Mouse Buttons */}
          <div className="h-16 w-full grid grid-cols-2 gap-2 pt-1 shrink-0 select-none">
            <button
              onPointerDown={handleLeftDown}
              onPointerUp={handleLeftUp}
              onPointerCancel={handleLeftUp}
              onLostPointerCapture={handleLeftUp}
              style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
              className={`h-full rounded-2xl border font-semibold text-sm transition-all shadow-md flex items-center justify-center select-none ${
                isLeftHeld
                  ? 'bg-brand-500 text-white border-brand-400 shadow-lg shadow-brand-500/40 scale-[0.98]'
                  : 'bg-dark-800 hover:bg-dark-700 active:bg-brand-500/20 active:border-brand-500/60 text-slate-200 border-slate-700/70'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full transition-colors ${isLeftHeld ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                <span>{isLeftHeld ? 'Left Click (Holding)' : 'Left Click'}</span>
              </div>
            </button>

            <button
              onPointerDown={handleRightDown}
              onPointerUp={handleRightUp}
              onPointerCancel={handleRightUp}
              onLostPointerCapture={handleRightUp}
              style={{ touchAction: 'none', WebkitUserSelect: 'none', userSelect: 'none' }}
              className={`h-full rounded-2xl border font-semibold text-sm transition-all shadow-md flex items-center justify-center select-none ${
                isRightHeld
                  ? 'bg-brand-500 text-white border-brand-400 shadow-lg shadow-brand-500/40 scale-[0.98]'
                  : 'bg-dark-800 hover:bg-dark-700 active:bg-brand-500/20 active:border-brand-500/60 text-slate-200 border-slate-700/70'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full transition-colors ${isRightHeld ? 'bg-white animate-pulse' : 'bg-slate-500'}`} />
                <span>{isRightHeld ? 'Right Click (Holding)' : 'Right Click'}</span>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

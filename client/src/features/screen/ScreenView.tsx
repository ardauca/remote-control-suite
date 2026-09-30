import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useScreenStore, ScreenPreset } from '../../stores/screenStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { wsClient } from '../../protocol/wsClient';
import { decodeBinaryFrame } from './screenDecoder';
import { 
  Play, 
  Pause, 
  Camera, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Wifi, 
  Smartphone, 
  Sliders, 
  MousePointer,
  ChevronDown,
  ChevronUp,
  RotateCw,
  X
} from 'lucide-react';

export const ScreenView: React.FC = () => {
  const { 
    isStreaming, 
    activePreset, 
    telemetry, 
    zoom, 
    startStream, 
    stopStream, 
    requestSnapshot, 
    sendTouch, 
    setPreset, 
    setZoom 
  } = useScreenStore();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const lastSeqRef = useRef<number>(0);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({ x: 50, y: 50, visible: false });
  const [desktopDims, setDesktopDims] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const [boxDims, setBoxDims] = useState<{ width: number; height: number }>({ width: 320, height: 180 });

  // Fullscreen & Rotation state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isRotated90, setIsRotated90] = useState<boolean>(false);
  const [showNormalTelemetry, setShowNormalTelemetry] = useState<boolean>(false);

  // Zoom & Pan state
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Pointer & Pinch tracking refs
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null);
  const initialPinchDistRef = useRef<number | null>(null);
  const initialPinchZoomRef = useRef<number>(1.0);

  // Touch gesture state
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const vibrate = (ms = 10) => {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  };

  // Handle Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    vibrate(15);
    setIsFullscreen((prev) => !prev);
  }, []);

  // Aspect-fit calculator: computes precise width & height for containerRef inside wrapperRef
  const updateAspectBox = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;

    // When software-rotated 90deg, swap available container width and height
    const availW = isRotated90 ? el.clientHeight : el.clientWidth;
    const availH = isRotated90 ? el.clientWidth : el.clientHeight;
    if (!availW || !availH) return;

    const targetRatio = (desktopDims.width || 1920) / (desktopDims.height || 1080);
    const containerRatio = availW / availH;

    let w: number;
    let h: number;
    if (containerRatio > targetRatio) {
      // Constrained by height (e.g. landscape mode or tall container)
      h = availH;
      w = h * targetRatio;
    } else {
      // Constrained by width (e.g. portrait mode)
      w = availW;
      h = w / targetRatio;
    }

    setBoxDims({ width: Math.round(w), height: Math.round(h) });
  }, [desktopDims.width, desktopDims.height, isRotated90]);

  // ResizeObserver & window orientation watcher
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    const observer = new ResizeObserver(() => {
      updateAspectBox();
    });
    observer.observe(el);
    updateAspectBox();

    window.addEventListener('resize', updateAspectBox);
    window.addEventListener('orientationchange', updateAspectBox);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateAspectBox);
      window.removeEventListener('orientationchange', updateAspectBox);
    };
  }, [updateAspectBox, isFullscreen, isRotated90]);

  // 1. Binary Frame Processing Loop
  const handleBinaryFrame = useCallback((buffer: ArrayBuffer) => {
    const frame = decodeBinaryFrame(buffer);
    if (!frame) return;

    // Stale frame drop: Discard frame if out of sequence
    if (frame.sequenceNumber <= lastSeqRef.current && lastSeqRef.current - frame.sequenceNumber < 100000) {
      return;
    }
    lastSeqRef.current = frame.sequenceNumber;

    if (desktopDims.width !== frame.desktopWidth || desktopDims.height !== frame.desktopHeight) {
      setDesktopDims({ width: frame.desktopWidth, height: frame.desktopHeight });
    }

    setCursorPos({
      x: frame.normCursorX * 100,
      y: frame.normCursorY * 100,
      visible: frame.cursorVisible
    });

    // Render image to canvas
    const img = new Image();
    const url = URL.createObjectURL(frame.imageBlob);
    img.onload = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
        }
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
        }
      }
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }, [desktopDims.width, desktopDims.height]);

  // 2. Lifecycle: Start on mount, stop on unmount, handle visibility
  useEffect(() => {
    const unregister = wsClient.onBinary(handleBinaryFrame);

    if (activePreset !== 'snapshot') {
      startStream();
    } else {
      requestSnapshot();
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stopStream();
      } else if (document.visibilityState === 'visible' && activePreset !== 'snapshot') {
        startStream();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unregister();
      document.removeEventListener('visibilitychange', handleVisibility);
      stopStream();
      if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    };
  }, [handleBinaryFrame, startStream, stopStream, requestSnapshot, activePreset]);

  // Re-start screen streaming automatically if connection drops and reconnects
  const connectionStatus = useConnectionStore((s) => s.status);
  const prevStatusRef = useRef(connectionStatus);
  useEffect(() => {
    if (prevStatusRef.current !== 'connected' && connectionStatus === 'connected') {
      if (activePreset !== 'snapshot') {
        startStream();
      } else {
        requestSnapshot();
      }
    }
    prevStatusRef.current = connectionStatus;
  }, [connectionStatus, activePreset, startStream, requestSnapshot]);

  // Pan Boundary Clamper
  const clampPan = (newX: number, newY: number, curZoom: number) => {
    const maxPanX = Math.max(0, Math.round(((boxDims.width || 320) * (curZoom - 1)) / 2));
    const maxPanY = Math.max(0, Math.round(((boxDims.height || 180) * (curZoom - 1)) / 2));
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, newX)),
      y: Math.max(-maxPanY, Math.min(maxPanY, newY))
    };
  };

  // Normalized coordinate mapper respecting normal orientation, 90-degree software rotation, zoom and pan
  const getNormalizedCoords = (clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();

    if (!isRotated90) {
      // 1. Position relative to container box
      const visualX = clientX - rect.left;
      const visualY = clientY - rect.top;

      // 2. Invert zoom & pan transform (which expands from center)
      const cx = (boxDims.width / 2) + (visualX - (boxDims.width / 2) - pan.x) / zoom;
      const cy = (boxDims.height / 2) + (visualY - (boxDims.height / 2) - pan.y) / zoom;

      const normX = Math.max(0, Math.min(1, cx / (boxDims.width || 1)));
      const normY = Math.max(0, Math.min(1, cy / (boxDims.height || 1)));
      return { normX, normY };
    } else {
      // 90-degree clockwise rotation math
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = clientX - centerX;
      const dy = clientY - centerY;

      // Inverse 90deg rotation to find unrotated local coordinates
      const localX = dy;
      const localY = -dx;

      // Invert zoom & pan transform
      const cx = (boxDims.width / 2) + (localX - pan.x) / zoom;
      const cy = (boxDims.height / 2) + (localY - pan.y) / zoom;

      const normX = Math.max(0, Math.min(1, cx / (boxDims.width || 1)));
      const normY = Math.max(0, Math.min(1, cy / (boxDims.height || 1)));
      return { normX, normY };
    }
  };

  // 3. Touch interaction handlers on the PC Screen
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (isPanMode) {
      // Pan & Zoom Mode: Never send clicks to Windows
      if (activePointersRef.current.size === 1) {
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      } else if (activePointersRef.current.size === 2) {
        const pts = Array.from(activePointersRef.current.values());
        initialPinchDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        initialPinchZoomRef.current = zoom;
      }
      return;
    }

    // Click Mode (When Kaydır is OFF)
    const coords = getNormalizedCoords(e.clientX, e.clientY);
    if (!coords) return;

    touchStartRef.current = { x: coords.normX, y: coords.normY, time: Date.now() };

    // Setup long press for Right Click
    longPressTimerRef.current = window.setTimeout(() => {
      vibrate(30);
      sendTouch(coords.normX, coords.normY, 'right', 'right');
      touchStartRef.current = null;
    }, 550);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (isPanMode) {
      // Multi-touch: Pinch to Zoom
      if (activePointersRef.current.size === 2) {
        const pts = Array.from(activePointersRef.current.values());
        const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (initialPinchDistRef.current && initialPinchDistRef.current > 0) {
          const ratio = curDist / initialPinchDistRef.current;
          const targetZoom = Math.max(1.0, Math.min(3.5, initialPinchZoomRef.current * ratio));
          setZoom(Number(targetZoom.toFixed(2)));
        }
        return;
      }

      // Single-finger: Pan / Drag Screen
      if (activePointersRef.current.size === 1 && lastPanPosRef.current) {
        const dx = e.clientX - lastPanPosRef.current.x;
        const dy = e.clientY - lastPanPosRef.current.y;
        lastPanPosRef.current = { x: e.clientX, y: e.clientY };

        let deltaX = dx;
        let deltaY = dy;
        if (isRotated90) {
          deltaX = dy;
          deltaY = -dx;
        }

        setPan((prev) => clampPan(prev.x + deltaX, prev.y + deltaY, zoom));
      }
      return;
    }

    // Cancel long press if finger moved significantly
    if (touchStartRef.current && (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4)) {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);

    if (isPanMode) {
      if (activePointersRef.current.size === 0) {
        lastPanPosRef.current = null;
        initialPinchDistRef.current = null;
      } else if (activePointersRef.current.size === 1) {
        const remaining = Array.from(activePointersRef.current.values())[0];
        lastPanPosRef.current = { x: remaining.x, y: remaining.y };
        initialPinchDistRef.current = null;
      }
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!touchStartRef.current) return;

    const coords = getNormalizedCoords(e.clientX, e.clientY);
    if (!coords) return;
    const { normX, normY } = coords;
    const now = Date.now();

    // Check for Double Click (< 300ms)
    if (
      lastTapRef.current &&
      now - lastTapRef.current.time < 300 &&
      Math.abs(normX - lastTapRef.current.x) < 0.05 &&
      Math.abs(normY - lastTapRef.current.y) < 0.05
    ) {
      vibrate(15);
      sendTouch(normX, normY, 'double', 'left');
      lastTapRef.current = null;
    } else {
      // Single Click
      vibrate(10);
      sendTouch(normX, normY, 'click', 'left');
      lastTapRef.current = { x: normX, y: normY, time: now };
    }

    touchStartRef.current = null;
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (isPanMode || e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      handleZoomChange(delta);
    }
  };

  const toggleStream = () => {
    vibrate(15);
    if (isStreaming) {
      stopStream();
    } else {
      startStream();
    }
  };

  const handleZoomChange = (delta: number) => {
    vibrate(10);
    const next = Math.max(1.0, Math.min(3.5, zoom + delta));
    setZoom(next);
    if (next === 1.0) setPan({ x: 0, y: 0 });
  };

  const presetsConfig: Array<{ id: ScreenPreset; label: string; sub: string; icon: React.FC<{ className?: string }> }> = [
    { id: 'mobile', label: 'Mobil', sub: '8 FPS • 540p', icon: Smartphone },
    { id: 'balanced', label: 'Dengeli', sub: '15 FPS • 720p', icon: Wifi },
    { id: 'high', label: 'Wi-Fi HD', sub: '25 FPS • 1080p', icon: Maximize2 },
    { id: 'snapshot', label: 'Tek Kare', sub: '0 MB • Statik', icon: Camera }
  ];

  // Helper for rendering the interactive canvas and vector cursor
  const renderInteractiveCanvas = () => (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
      style={{
        width: `${boxDims.width}px`,
        height: `${boxDims.height}px`,
        transform: isRotated90 ? 'rotate(90deg)' : undefined,
        transformOrigin: 'center center'
      }}
      className={`relative shrink-0 select-none touch-none overflow-hidden transition-transform duration-200 ${
        isPanMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
      }`}
    >
      {/* Zoom / Pan transformation container */}
      <div 
        className="w-full h-full flex items-center justify-center transition-transform duration-75"
        style={{
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`
        }}
      >
        <canvas 
          ref={canvasRef} 
          className="w-full h-full object-contain pointer-events-none"
        />

        {/* Real-Time Hardware SVG Vector Cursor */}
        {cursorPos.visible && (
          <div 
            className="absolute pointer-events-none transition-all duration-75"
            style={{
              left: `${cursorPos.x}%`,
              top: `${cursorPos.y}%`,
              transform: 'translate(-2px, -2px)'
            }}
          >
            <svg 
              className="w-5 h-5 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" 
              viewBox="0 0 24 24" 
              fill="black" 
              stroke="white" 
              strokeWidth="1.5"
            >
              <path d="M3 3l7 18 3-7 7-3L3 3z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ========================================================================= */}
      {/* 1. FULLSCREEN MODE (Zero Screen Obstruction, Collapsible Floating Menu)   */}
      {/* ========================================================================= */}
      {isFullscreen ? (
        <div 
          ref={wrapperRef}
          className="fixed inset-0 z-50 bg-black w-screen h-[100dvh] flex items-center justify-center overflow-hidden touch-none select-none animate-fadeIn"
        >
          {/* Main Canvas Component - 100% of PC Screen is Clickable */}
          {renderInteractiveCanvas()}

          {/* Top-Left Minimalist Telemetry Pill (Non-intrusive) */}
          <div 
            style={{
              top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
              left: 'calc(env(safe-area-inset-left, 0px) + 12px)',
            }}
            className="absolute z-30 flex items-center gap-2 bg-dark-900/60 border border-slate-700/50 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-mono text-slate-300 pointer-events-none opacity-50"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>{telemetry?.actualFps ?? 0} FPS</span>
            <span>•</span>
            <span>{telemetry?.bytesPerSecond ? `${Math.round(telemetry.bytesPerSecond / 1024)} KB/s` : '0 KB/s'}</span>
          </div>

          {/* Fullscreen Floating Controls Dock (Alt Ortada, Geniş ve Rahat Dokunmatik) */}
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            onTouchStart={(e) => e.stopPropagation()}
            style={{
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
            }}
            className="absolute z-40 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-dark-900/90 border border-slate-700/80 backdrop-blur-2xl p-2 rounded-2xl shadow-2xl transition-all max-w-[95vw] select-none"
          >
            {/* Primary Action: Direct Exit Fullscreen (Large, High Contrast, 1-Tap) */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                vibrate(15);
                toggleFullscreen();
              }}
              className="h-12 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 active:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-rose-950/60 border border-rose-400/40 active:scale-95 transition-all select-none"
              title="Tam Ekrandan Çık"
            >
              <X className="w-5 h-5 text-white" />
              <span className="font-bold tracking-wide">Kapat</span>
            </button>

            {/* Direct 90° Rotation Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                vibrate(15);
                setIsRotated90((r) => !r);
              }}
              className={`h-12 px-3.5 rounded-xl border flex items-center gap-1.5 font-bold text-xs active:scale-95 transition-all shadow-md select-none ${
                isRotated90
                  ? 'bg-brand-600 text-white border-brand-400 shadow-brand-500/30'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
              }`}
              title={isRotated90 ? 'Dikey Mod' : '90° Yatay Mod'}
            >
              <RotateCw className={`w-4 h-4 ${isRotated90 ? 'text-white' : 'text-amber-400'}`} />
              <span>90°</span>
            </button>

            {/* Zoom Stepper */}
            <div className="flex items-center bg-slate-800/90 rounded-xl border border-slate-700 h-12 px-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleZoomChange(-0.5);
                }}
                disabled={zoom <= 1}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 disabled:opacity-30 active:scale-95"
                title="Uzaklaştır"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  vibrate(10);
                  setZoom(1.0);
                  setPan({ x: 0, y: 0 });
                }}
                className="px-2 text-xs font-mono font-bold text-cyan-400 active:scale-95"
                title="Sıfırla"
              >
                {zoom.toFixed(1)}x
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleZoomChange(0.5);
                }}
                disabled={zoom >= 3}
                className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-300 disabled:opacity-30 active:scale-95"
                title="Yakınlaştır"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            {/* Pan Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                vibrate(10);
                setIsPanMode(!isPanMode);
              }}
              className={`h-12 px-3.5 rounded-xl border font-bold text-xs transition-all active:scale-95 select-none ${
                isPanMode 
                  ? 'bg-brand-500 text-white border-brand-400 shadow-md shadow-brand-500/30 ring-2 ring-brand-400/40' 
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title={isPanMode ? 'Kaydırma Modu Açık (Sürükle & Yakınlaştır)' : 'Tıklama Modu (Windows Tıkla)'}
            >
              {isPanMode ? 'Kaydır (Açık)' : 'Kaydır'}
            </button>
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* 2. NORMAL SCREEN VIEW (Clean Canvas, Controls Above & Below Canvas)        */
        /* ========================================================================= */
        <div className="w-full flex flex-col space-y-2.5 select-none pb-8 animate-fadeIn">
          {/* Header Toolbar */}
          <div className="shrink-0 flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <MousePointer className="w-4 h-4 text-cyan-400" />
                  Ekran Ayna & Akış
                </h2>
                <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded-md border tracking-wider ${
                  isStreaming 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse' 
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {isStreaming ? 'CANLI' : 'DURDURULDU'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {desktopDims.width}×{desktopDims.height} • Dokunarak tıkla
              </p>
            </div>

            {/* Quick Action Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Prominent Fullscreen Hero Button */}
              <button
                onClick={toggleFullscreen}
                className="h-9 px-3 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-500 hover:from-brand-500 hover:to-cyan-400 text-white font-bold text-xs flex items-center gap-1.5 shadow-md shadow-brand-500/30 border border-brand-400/30 active:scale-95 transition-all select-none"
                title="Tam Ekrana Geç"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Tam Ekran</span>
              </button>

              {/* 90° Rotate Button */}
              <button
                onClick={() => {
                  vibrate(10);
                  setIsRotated90(!isRotated90);
                }}
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all active:scale-95 shadow-sm ${
                  isRotated90 
                    ? 'bg-brand-600 text-white border-brand-400 shadow-brand-500/20' 
                    : 'bg-dark-800 hover:bg-dark-700 text-slate-300 border-slate-700'
                }`}
                title="Görünümü Döndür"
              >
                <RotateCw className="w-4 h-4 text-amber-400" />
              </button>

              {/* Snapshot Button */}
              <button
                onClick={() => {
                  vibrate(15);
                  requestSnapshot();
                }}
                title="Anlık Kare Al (Snapshot)"
                className="w-9 h-9 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-300 border border-slate-700 flex items-center justify-center active:scale-95 transition-all shadow-sm"
              >
                <Camera className="w-4 h-4" />
              </button>

              {/* Play/Pause Button */}
              <button
                onClick={toggleStream}
                title={isStreaming ? 'Akışı Duraklat' : 'Akışı Başlat'}
                className={`w-9 h-9 rounded-xl border flex items-center justify-center transition-all active:scale-95 shadow-sm ${
                  isStreaming
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/30'
                }`}
              >
                {isStreaming ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              </button>
            </div>
          </div>

          {/* Interactive Screen Canvas Card (Clean - Zero overlay buttons covering Windows) */}
          <div 
            ref={wrapperRef}
            className="relative w-full aspect-[16/9] bg-black rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl flex items-center justify-center touch-none"
          >
            {renderInteractiveCanvas()}
          </div>

          {/* Compact Zoom & Pan Bar */}
          <div className="shrink-0 bg-dark-800/80 rounded-2xl p-2 border border-slate-800 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-2 pl-2">
              <span className="text-[11px] font-semibold text-slate-400">Ölçek:</span>
              <span className="px-2 py-0.5 rounded-md bg-dark-900 border border-slate-700 text-xs font-mono font-bold text-cyan-400">
                {zoom.toFixed(1)}x
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => handleZoomChange(-0.5)}
                disabled={zoom <= 1}
                className="w-8 h-8 rounded-lg bg-dark-900 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"
                title="Uzaklaştır"
              >
                <ZoomOut className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  vibrate(10);
                  setZoom(1.0);
                  setPan({ x: 0, y: 0 });
                }}
                className="px-2.5 h-8 rounded-lg bg-dark-900 border border-slate-700 text-[11px] font-mono font-bold text-slate-300 hover:text-cyan-400 active:scale-95 transition-all"
                title="Zoom Sıfırla"
              >
                1.0x
              </button>

              <button
                onClick={() => handleZoomChange(0.5)}
                disabled={zoom >= 3}
                className="w-8 h-8 rounded-lg bg-dark-900 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center disabled:opacity-30 active:scale-95 transition-all"
                title="Yakınlaştır"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  vibrate(5);
                  setIsPanMode(!isPanMode);
                }}
                className={`h-8 px-2.5 rounded-lg text-xs font-bold border transition-all flex items-center gap-1.5 active:scale-95 select-none ${
                  isPanMode 
                    ? 'bg-brand-500 text-white border-brand-400 shadow-md shadow-brand-500/25' 
                    : 'bg-dark-900 text-slate-400 border-slate-700 hover:text-white'
                }`}
                title={isPanMode ? 'Kaydırma Modu Açık (Sürükle & Yakınlaştır)' : 'Tıklama Modu (Windows Tıkla)'}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>{isPanMode ? 'Kaydır (Açık)' : 'Kaydır'}</span>
              </button>
            </div>
          </div>

          {/* Compact Streaming Profiles Card */}
          <div className="shrink-0 bg-dark-800/80 rounded-2xl p-3 border border-slate-800 shadow-md space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-brand-400" />
                Yayın Kalitesi
              </span>
              <span className="text-[10px] font-bold font-mono px-2 py-0.5 rounded-md bg-dark-900 border border-slate-700/80 text-cyan-400">
                {presetsConfig.find(p => p.id === activePreset)?.label}
              </span>
            </div>

            {/* Segmented Control Buttons */}
            <div className="grid grid-cols-4 gap-1.5 bg-dark-900 p-1 rounded-xl border border-slate-800">
              {presetsConfig.map((preset) => {
                const Icon = preset.icon;
                const isSel = activePreset === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      vibrate(10);
                      setPreset(preset.id);
                    }}
                    className={`py-2 px-1 rounded-lg flex flex-col items-center justify-center gap-1 transition-all text-center select-none ${
                      isSel 
                        ? 'bg-gradient-to-b from-brand-600 to-brand-700 text-white font-bold shadow-md shadow-brand-500/30 border border-brand-400/40' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-dark-800/60'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-semibold leading-tight truncate w-full">{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Active profile description & consumption estimate */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 px-1 font-mono">
              <span>{presetsConfig.find(p => p.id === activePreset)?.sub}</span>
              <span className="text-amber-400/90 font-medium">
                {telemetry?.estimatedGbPerHour ? `Tahmini ~${telemetry.estimatedGbPerHour} GB/saat` : 'Tasarruf Modu'}
              </span>
            </div>
          </div>

          {/* Compact Telemetry Bar (Collapsible to save vertical space) */}
          <div className="shrink-0 bg-dark-800/80 rounded-2xl p-2.5 border border-slate-800 shadow-md">
            <div 
              onClick={() => setShowNormalTelemetry(!showNormalTelemetry)}
              className="flex items-center justify-between cursor-pointer select-none"
            >
              <div className="flex items-center gap-2 text-xs font-mono">
                <span className="flex items-center gap-1.5 font-bold text-white">
                  <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                  {telemetry?.actualFps ?? 0} FPS
                </span>
                <span className="text-slate-700">•</span>
                <span className="text-cyan-400 font-medium">
                  {telemetry?.bytesPerSecond ? `${Math.round(telemetry.bytesPerSecond / 1024)} KB/s` : '0 KB/s'}
                </span>
                <span className="text-slate-700">•</span>
                <span className="text-amber-400 font-medium">
                  {telemetry?.estimatedMbPerMinute ? `${telemetry.estimatedMbPerMinute} MB/dk` : '—'}
                </span>
              </div>

              <div className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-white px-2 py-0.5 rounded-lg bg-dark-900 border border-slate-700/80 transition-colors">
                <span>{showNormalTelemetry ? 'Gizle' : 'Detay'}</span>
                {showNormalTelemetry ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </div>

            {/* Collapsible Details */}
            {showNormalTelemetry && (
              <div className="grid grid-cols-4 gap-1.5 pt-2.5 mt-2 border-t border-slate-800 text-center font-mono animate-fadeIn">
                <div className="bg-dark-900 rounded-lg p-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Kuyruk</div>
                  <div className="text-xs font-bold text-slate-300">{telemetry?.queueDepth ?? 0}</div>
                </div>
                <div className="bg-dark-900 rounded-lg p-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Atlanan</div>
                  <div className="text-xs font-bold text-rose-400">{telemetry?.droppedFrames ?? 0}</div>
                </div>
                <div className="bg-dark-900 rounded-lg p-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Yakalama</div>
                  <div className="text-xs font-bold text-slate-300">{telemetry?.captureDurationMs ?? 0}ms</div>
                </div>
                <div className="bg-dark-900 rounded-lg p-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Gönderme</div>
                  <div className="text-xs font-bold text-slate-300">{telemetry?.sendDurationMs ?? 0}ms</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};

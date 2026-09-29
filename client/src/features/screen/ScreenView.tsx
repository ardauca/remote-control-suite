import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useScreenStore, ScreenPreset } from '../../stores/screenStore';
import { wsClient } from '../../protocol/wsClient';
import { decodeBinaryFrame } from './screenDecoder';
import { 
  Play, 
  Pause, 
  Camera, 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Minimize2,
  Activity, 
  Wifi, 
  Smartphone, 
  Sliders, 
  MousePointer,
  ChevronDown,
  ChevronUp,
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

  // Fullscreen & UI controls state
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [controlsVisible, setControlsVisible] = useState<boolean>(true);
  const controlsTimerRef = useRef<number | null>(null);
  const [showFullTelemetry, setShowFullTelemetry] = useState<boolean>(false);
  const [showNormalTelemetry, setShowNormalTelemetry] = useState<boolean>(false);

  // Zoom & Pan state
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Touch gesture state
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const vibrate = (ms = 10) => {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  };

  // Auto-hide controls in Fullscreen mode
  const resetControlsTimeout = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) {
      window.clearTimeout(controlsTimerRef.current);
    }
    if (isFullscreen) {
      controlsTimerRef.current = window.setTimeout(() => {
        setControlsVisible(false);
      }, 3500);
    }
  }, [isFullscreen]);

  // Handle Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    vibrate(15);
    setIsFullscreen((prev) => {
      const next = !prev;
      setControlsVisible(true);
      if (next) {
        if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
        controlsTimerRef.current = window.setTimeout(() => setControlsVisible(false), 3500);
      } else {
        if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
      }
      return next;
    });
  }, []);

  // Aspect-fit calculator: computes precise width & height for containerRef inside wrapperRef
  const updateAspectBox = useCallback(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const availW = el.clientWidth;
    const availH = el.clientHeight;
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
  }, [desktopDims.width, desktopDims.height]);

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
  }, [updateAspectBox, isFullscreen]);

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
      if (controlsTimerRef.current) window.clearTimeout(controlsTimerRef.current);
    };
  }, [handleBinaryFrame, startStream, stopStream, requestSnapshot, activePreset]);

  // 3. Touch interaction handlers on the PC Screen
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen) {
      resetControlsTimeout();
    }

    if (isPanMode) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));

    touchStartRef.current = { x: normX, y: normY, time: Date.now() };

    // Setup long press for Right Click
    longPressTimerRef.current = window.setTimeout(() => {
      vibrate(30);
      sendTouch(normX, normY, 'right', 'right');
      touchStartRef.current = null;
    }, 550);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isFullscreen) {
      resetControlsTimeout();
    }

    if (isPanMode) {
      if (e.buttons === 1) {
        setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
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
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isPanMode || !touchStartRef.current) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const normX = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const normY = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
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
    { id: 'mobile', label: 'Mobil Veri', sub: '8 FPS • 540p', icon: Smartphone },
    { id: 'balanced', label: 'Dengeli', sub: '15 FPS • 720p', icon: Wifi },
    { id: 'high', label: 'Wi-Fi Yüksek', sub: '25 FPS • 1080p', icon: Maximize2 },
    { id: 'snapshot', label: 'Tek Kare', sub: '0 MB Sürekli', icon: Camera }
  ];

  // Helper for rendering the interactive canvas and vector cursor
  const renderInteractiveCanvas = () => (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        width: `${boxDims.width}px`,
        height: `${boxDims.height}px`
      }}
      className="relative shrink-0 select-none touch-none overflow-hidden cursor-crosshair"
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
      {/* 1. FULLSCREEN MODE (Takes 100% of viewport, handles portrait & landscape) */}
      {/* ========================================================================= */}
      {isFullscreen ? (
        <div 
          ref={wrapperRef}
          className="fixed inset-0 z-50 bg-black w-screen h-[100dvh] flex items-center justify-center overflow-hidden touch-none select-none safe-top safe-bottom safe-left safe-right animate-fadeIn"
          onPointerDown={() => resetControlsTimeout()}
        >
          {/* Main Canvas Component */}
          {renderInteractiveCanvas()}

          {/* Top-Left Floating Minimal HUD */}
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowFullTelemetry(!showFullTelemetry);
            }}
            className={`absolute top-3 left-3 z-30 transition-opacity duration-300 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-900/85 backdrop-blur-md border border-slate-700/80 text-xs font-mono text-slate-200 shadow-2xl cursor-pointer active:scale-95 transition-transform">
              <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
              <span className="font-bold text-white">{telemetry?.actualFps ?? 0} FPS</span>
              <span className="text-slate-500">•</span>
              <span className="text-cyan-400">
                {telemetry?.bytesPerSecond ? `${Math.round(telemetry.bytesPerSecond / 1024)} KB/s` : '0 KB/s'}
              </span>
              <Activity className="w-3.5 h-3.5 text-slate-400 ml-0.5" />
            </div>

            {/* Detailed Fullscreen Telemetry Popover */}
            {showFullTelemetry && (
              <div 
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                className="mt-2 p-3 bg-dark-900/95 backdrop-blur-xl border border-slate-700 rounded-2xl shadow-2xl text-[11px] font-mono text-slate-300 space-y-1.5 min-w-[210px] animate-fadeIn"
              >
                <div className="flex items-center justify-between font-bold text-white border-b border-slate-800 pb-1">
                  <span>CANLI TELEMETRİ</span>
                  <button 
                    onClick={() => setShowFullTelemetry(false)}
                    className="text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gerçek FPS:</span>
                  <span className="text-emerald-400 font-bold">{telemetry?.actualFps ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Bant Genişliği:</span>
                  <span className="text-cyan-400 font-bold">
                    {telemetry?.bytesPerSecond ? `${Math.round(telemetry.bytesPerSecond / 1024)} KB/s` : '0 KB/s'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Veri / Dakika:</span>
                  <span className="text-amber-400 font-bold">
                    {telemetry?.estimatedMbPerMinute ? `~${telemetry.estimatedMbPerMinute} MB` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Tahmini / Saat:</span>
                  <span className="text-amber-300 font-bold">
                    {telemetry?.estimatedGbPerHour ? `~${telemetry.estimatedGbPerHour} GB` : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Atlanan Kare:</span>
                  <span className="text-rose-400">{telemetry?.droppedFrames ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Gecikme (İşlem):</span>
                  <span>{telemetry?.captureDurationMs ?? 0} ms</span>
                </div>
              </div>
            )}
          </div>

          {/* Top-Right Exit Fullscreen Button */}
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute top-3 right-3 z-30 transition-opacity duration-300 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <button
              onClick={toggleFullscreen}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-dark-900/85 backdrop-blur-md border border-slate-700/80 text-xs font-semibold text-slate-200 hover:text-white shadow-2xl active:scale-90 transition-all"
              title="Tam Ekrandan Çık"
            >
              <Minimize2 className="w-3.5 h-3.5 text-cyan-400" />
              <span>Normal Ekran</span>
            </button>
          </div>

          {/* Bottom-Right Floating Zoom & Pan Controls */}
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            className={`absolute bottom-4 right-4 z-30 flex items-center gap-1 bg-dark-900/85 backdrop-blur-md rounded-2xl p-1.5 border border-slate-700/80 shadow-2xl transition-opacity duration-300 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <button
              onClick={() => handleZoomChange(-0.5)}
              className="p-2 rounded-xl text-slate-300 hover:text-white active:scale-90 transition-transform"
              title="Uzaklaştır"
            >
              <ZoomOut className="w-4 h-4" />
            </button>

            <button
              onClick={() => {
                vibrate(10);
                setZoom(1.0);
                setPan({ x: 0, y: 0 });
              }}
              className="px-2 py-1 rounded-lg text-xs font-mono font-bold text-slate-200 hover:text-cyan-400 active:scale-95 transition-all"
              title="Zoom Sıfırla (1.0x)"
            >
              {zoom.toFixed(1)}x
            </button>

            <button
              onClick={() => handleZoomChange(0.5)}
              className="p-2 rounded-xl text-slate-300 hover:text-white active:scale-90 transition-transform"
              title="Yakınlaştır"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <div className="w-[1px] h-4 bg-slate-700 mx-0.5" />

            <button
              onClick={() => {
                vibrate(10);
                setIsPanMode(!isPanMode);
              }}
              className={`p-2 rounded-xl text-xs border transition-colors active:scale-90 ${
                isPanMode 
                  ? 'bg-brand-500 text-white border-brand-400 shadow-md shadow-brand-500/30' 
                  : 'text-slate-400 border-transparent hover:text-white'
              }`}
              title={isPanMode ? 'Pan Modu Aktif (Sürükle)' : 'Dokunmatik Tık Modu'}
            >
              <Sliders className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* 2. NORMAL SCREEN VIEW (Optimized vertical space, compact cards)            */
        /* ========================================================================= */
        <div className="w-full flex flex-col space-y-3 select-none pb-6 animate-fadeIn">
          {/* Header Toolbar */}
          <div className="shrink-0 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <MousePointer className="w-4 h-4 text-cyan-400" />
                  Ekran Ayna & Akış
                </h2>
                <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded-md border ${
                  isStreaming 
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30 animate-pulse' 
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}>
                  {isStreaming ? 'CANLI' : 'DURDURULDU'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {desktopDims.width}x{desktopDims.height} • Dokunarak tıkla
              </p>
            </div>

            {/* Quick Action Controls */}
            <div className="flex items-center gap-1.5">
              {/* Prominent Fullscreen Trigger */}
              <button
                onClick={toggleFullscreen}
                className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-brand-600 to-cyan-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-brand-500/25 active:scale-95 transition-all"
                title="Tam Ekrana Geç"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="font-bold">Tam Ekran</span>
              </button>

              <button
                onClick={() => {
                  vibrate(15);
                  requestSnapshot();
                }}
                title="Anlık Kare Al (Snapshot)"
                className="p-2 rounded-xl bg-dark-800 hover:bg-dark-700 text-slate-300 border border-slate-700 active:scale-95 transition-all"
              >
                <Camera className="w-4 h-4" />
              </button>

              <button
                onClick={toggleStream}
                title={isStreaming ? 'Akışı Duraklat' : 'Akışı Başlat'}
                className={`p-2 rounded-xl border transition-all active:scale-95 shadow-md ${
                  isStreaming
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                    : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                }`}
              >
                {isStreaming ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
              </button>
            </div>
          </div>

          {/* Interactive Screen Canvas Card (Aspect Fit, Maximize Display Area) */}
          <div 
            ref={wrapperRef}
            className="relative w-full aspect-[16/9] bg-black rounded-2xl overflow-hidden border-2 border-slate-700/80 shadow-2xl flex items-center justify-center touch-none"
          >
            {renderInteractiveCanvas()}

            {/* Floating 'Tam Ekran' Badge on Canvas */}
            <div className="absolute top-2.5 right-2.5 z-10">
              <button
                onClick={toggleFullscreen}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-dark-900/80 backdrop-blur-md text-[11px] font-semibold text-slate-200 border border-slate-700/70 shadow-lg active:scale-90 transition-all hover:text-white"
              >
                <Maximize2 className="w-3 h-3 text-cyan-400" />
                <span>⛶ Tam Ekran</span>
              </button>
            </div>

            {/* Floating Zoom & Pan Controls on Canvas */}
            <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 bg-dark-900/80 backdrop-blur-md rounded-2xl p-1 border border-slate-700/60 shadow-lg">
              <button
                onClick={() => handleZoomChange(-0.5)}
                className="p-1.5 rounded-xl text-slate-300 hover:text-white active:scale-95"
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
                className="text-[10px] font-mono font-bold text-slate-300 px-1 hover:text-cyan-400"
                title="Zoom Sıfırla"
              >
                {zoom.toFixed(1)}x
              </button>

              <button
                onClick={() => handleZoomChange(0.5)}
                className="p-1.5 rounded-xl text-slate-300 hover:text-white active:scale-95"
                title="Yakınlaştır"
              >
                <ZoomIn className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => {
                  vibrate(5);
                  setIsPanMode(!isPanMode);
                }}
                className={`p-1.5 rounded-xl text-xs border transition-colors ${
                  isPanMode 
                    ? 'bg-brand-500 text-white border-brand-400' 
                    : 'text-slate-400 border-transparent hover:text-white'
                }`}
                title={isPanMode ? 'Pan Modu Aktif (Sürükle)' : 'Dokunmatik Tık Modu'}
              >
                <Sliders className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Compact Streaming Profiles & Live Data Rate */}
          <div className="shrink-0 bg-dark-800/80 rounded-2xl p-3 border border-slate-800 shadow-md space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Wifi className="w-3.5 h-3.5 text-brand-400" />
                Yayın Profili
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                {telemetry?.estimatedMbPerMinute ? (
                  <span className="text-amber-400 font-bold">~{telemetry.estimatedMbPerMinute} MB/dk</span>
                ) : (
                  <span className="text-slate-500">—</span>
                )}
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
                    className={`py-1.5 px-1 rounded-lg flex flex-col items-center justify-center gap-0.5 transition-all text-center ${
                      isSel 
                        ? 'bg-brand-600 text-white font-bold shadow-md shadow-brand-500/25' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] leading-tight truncate w-full">{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Active profile description & consumption estimate */}
            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 px-0.5 font-mono">
              <span>{presetsConfig.find(p => p.id === activePreset)?.sub}</span>
              <span>
                {telemetry?.estimatedGbPerHour ? `~${telemetry.estimatedGbPerHour} GB/saat` : 'Tasarruf Modu'}
              </span>
            </div>
          </div>

          {/* Compact Telemetry Bar (Collapsible to save vertical space) */}
          <div className="shrink-0 bg-dark-800/80 rounded-2xl p-2.5 border border-slate-800 shadow-md">
            <div 
              onClick={() => setShowNormalTelemetry(!showNormalTelemetry)}
              className="flex items-center justify-between cursor-pointer select-none"
            >
              <div className="flex items-center gap-2 text-xs font-mono text-slate-300">
                <span className={`w-2 h-2 rounded-full ${isStreaming ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className="font-bold text-white">{telemetry?.actualFps ?? 0} FPS</span>
                <span className="text-slate-600">|</span>
                <span className="text-cyan-400">
                  {telemetry?.bytesPerSecond ? `${Math.round(telemetry.bytesPerSecond / 1024)} KB/s` : '0 KB/s'}
                </span>
                <span className="text-slate-600">|</span>
                <span className="text-amber-400">
                  {telemetry?.estimatedMbPerMinute ? `${telemetry.estimatedMbPerMinute} MB/dk` : '—'}
                </span>
              </div>

              <div className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
                <span>{showNormalTelemetry ? 'Gizle' : 'Detay'}</span>
                {showNormalTelemetry ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </div>

            {/* Collapsible Details */}
            {showNormalTelemetry && (
              <div className="grid grid-cols-4 gap-1.5 pt-2.5 mt-2 border-t border-slate-800/80 text-center font-mono animate-fadeIn">
                <div className="bg-dark-900 rounded-lg p-1 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Kuyruk</div>
                  <div className="text-xs font-bold text-slate-300">{telemetry?.queueDepth ?? 0}</div>
                </div>
                <div className="bg-dark-900 rounded-lg p-1 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Atlanan</div>
                  <div className="text-xs font-bold text-rose-400">{telemetry?.droppedFrames ?? 0}</div>
                </div>
                <div className="bg-dark-900 rounded-lg p-1 border border-slate-800">
                  <div className="text-[9px] text-slate-500">Yakalama</div>
                  <div className="text-xs font-bold text-slate-300">{telemetry?.captureDurationMs ?? 0}ms</div>
                </div>
                <div className="bg-dark-900 rounded-lg p-1 border border-slate-800">
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

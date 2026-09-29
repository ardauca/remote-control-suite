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
  Activity, 
  Wifi, 
  Smartphone, 
  Sliders, 
  MousePointer
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

  const lastSeqRef = useRef<number>(0);
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; visible: boolean }>({ x: 50, y: 50, visible: false });
  const [desktopDims, setDesktopDims] = useState<{ width: number; height: number }>({ width: 1920, height: 1080 });
  const [showTelemetryHud, setShowTelemetryHud] = useState<boolean>(true);
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Touch gesture state
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const vibrate = (ms = 10) => {
    if ('vibrate' in navigator) navigator.vibrate(ms);
  };

  // 1. Binary Frame Processing Loop
  const handleBinaryFrame = useCallback((buffer: ArrayBuffer) => {
    const frame = decodeBinaryFrame(buffer);
    if (!frame) return;

    // Stale frame drop: Discard frame if out of sequence
    if (frame.sequenceNumber <= lastSeqRef.current && lastSeqRef.current - frame.sequenceNumber < 100000) {
      return;
    }
    lastSeqRef.current = frame.sequenceNumber;

    setDesktopDims({ width: frame.desktopWidth, height: frame.desktopHeight });
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
  }, []);

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
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    };
  }, [handleBinaryFrame, startStream, stopStream, requestSnapshot, activePreset]);

  // 3. Touch interaction handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanMode) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;

    touchStartRef.current = { x: normX, y: normY, time: Date.now() };

    // Setup long press for Right Click
    longPressTimerRef.current = window.setTimeout(() => {
      vibrate(30);
      sendTouch(normX, normY, 'right', 'right');
      touchStartRef.current = null;
    }, 550);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPanMode) {
      if (e.buttons === 1) {
        setPan((p) => ({ x: p.x + e.movementX, y: p.y + e.movementY }));
      }
      return;
    }

    // Cancel long press if finger moved significantly
    if (touchStartRef.current && (Math.abs(e.movementX) > 4 || Math.abs(e.movementY) > 4)) {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (isPanMode || !touchStartRef.current) return;

    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;

    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    const now = Date.now();

    // Check for Double Click
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

  return (
    <div className="w-full flex flex-col space-y-3 select-none pb-20 animate-fadeIn">
      {/* 1. Header Toolbar */}
      <div className="shrink-0 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white flex items-center gap-1.5">
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

        {/* Action Controls */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowTelemetryHud(!showTelemetryHud)}
            title="Telemetri Göstergesi"
            className={`p-2 rounded-xl border text-xs transition-all ${
              showTelemetryHud 
                ? 'bg-brand-500/20 text-brand-300 border-brand-500/40' 
                : 'bg-dark-800 text-slate-400 border-slate-700'
            }`}
          >
            <Activity className="w-4 h-4" />
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
            className={`px-3 py-2 rounded-xl flex items-center gap-1 text-xs font-bold border transition-all active:scale-95 shadow-md ${
              isStreaming
                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
            }`}
          >
            {isStreaming ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            {isStreaming ? 'Durdur' : 'Canlı Başlat'}
          </button>
        </div>
      </div>

      {/* 2. Interactive Screen Canvas Area */}
      <div 
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        className="shrink-0 relative w-full aspect-[16/9] bg-black rounded-3xl overflow-hidden border-2 border-slate-700/80 shadow-2xl touch-none flex items-center justify-center"
      >
        {/* Render Canvas */}
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

          {/* Real-Time Hardware SVG Cursor Overlay */}
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
                className="w-5 h-5 text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" 
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

        {/* Floating Zoom & Pan Controls on Canvas */}
        <div className="absolute bottom-2.5 right-2.5 z-10 flex items-center gap-1 bg-dark-900/80 backdrop-blur-md rounded-2xl p-1 border border-slate-700/60 shadow-lg">
          <button
            onClick={() => handleZoomChange(0.5)}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white active:scale-95"
            title="Yakınlaştır"
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          <span className="text-[10px] font-mono font-bold text-slate-400 px-1">
            {zoom.toFixed(1)}x
          </span>

          <button
            onClick={() => handleZoomChange(-0.5)}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white active:scale-95"
            title="Uzaklaştır"
          >
            <ZoomOut className="w-4 h-4" />
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
            <Sliders className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* 3. Live Bandwidth & Telemetry HUD */}
      {showTelemetryHud && (
        <div className="shrink-0 bg-dark-800/80 rounded-2xl p-3 border border-slate-700/60 shadow-md space-y-2">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-300 uppercase tracking-wider">
            <span className="flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-cyan-400" />
              Canlı Telemetri & Ağ Tüketimi
            </span>
            <span className="text-slate-500 font-mono font-normal">
              Kuyruk: {telemetry?.queueDepth ?? 0}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center">
            <div className="bg-dark-900 rounded-xl p-1.5 border border-slate-700/50">
              <div className="text-[10px] text-slate-400">FPS</div>
              <div className="text-sm font-bold font-mono text-emerald-400">
                {telemetry?.actualFps ?? 0}
              </div>
            </div>

            <div className="bg-dark-900 rounded-xl p-1.5 border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Bant Genişliği</div>
              <div className="text-sm font-bold font-mono text-cyan-400">
                {telemetry?.bytesPerSecond ? `${Math.round(telemetry.bytesPerSecond / 1024)} KB/s` : '0 KB/s'}
              </div>
            </div>

            <div className="bg-dark-900 rounded-xl p-1.5 border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Tahmini Veri</div>
              <div className="text-sm font-bold font-mono text-amber-400">
                {telemetry?.estimatedMbPerMinute ? `${telemetry.estimatedMbPerMinute} MB/dk` : '0 MB'}
              </div>
            </div>

            <div className="bg-dark-900 rounded-xl p-1.5 border border-slate-700/50">
              <div className="text-[10px] text-slate-400">Atlanan Kare</div>
              <div className="text-sm font-bold font-mono text-rose-400">
                {telemetry?.droppedFrames ?? 0}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 4. Streaming Profiles & Presets */}
      <div className="shrink-0 bg-dark-800/80 rounded-3xl p-4 border border-slate-700/60 shadow-xl space-y-3">
        <div className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
          <Wifi className="w-4 h-4 text-brand-400" />
          Yayın Profilleri & Tasarruf Seçenekleri
        </div>

        <div className="grid grid-cols-4 gap-2">
          {([
            { id: 'mobile' as ScreenPreset, label: 'Mobil Veri', sub: '8 FPS / 540p', icon: Smartphone },
            { id: 'balanced' as ScreenPreset, label: 'Dengeli', sub: '15 FPS / 720p', icon: Wifi },
            { id: 'high' as ScreenPreset, label: 'Wi-Fi Yüksek', sub: '25 FPS / 1080p', icon: Maximize2 },
            { id: 'snapshot' as ScreenPreset, label: 'Tek Kare', sub: '0 MB Sürekli', icon: Camera }
          ]).map((preset) => {
            const Icon = preset.icon;
            const isSel = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => {
                  vibrate(10);
                  setPreset(preset.id);
                }}
                className={`p-2.5 rounded-2xl flex flex-col items-center justify-center gap-1 text-center transition-all border active:scale-95 ${
                  isSel
                    ? 'bg-brand-500/20 text-brand-300 border-brand-500/50 shadow-md shadow-brand-500/20'
                    : 'bg-dark-900 text-slate-400 border-slate-700 hover:text-white'
                }`}
              >
                <Icon className={`w-4 h-4 ${isSel ? 'text-brand-400' : 'text-slate-400'}`} />
                <span className="text-[11px] font-bold leading-tight">{preset.label}</span>
                <span className="text-[9px] text-slate-500 font-mono">{preset.sub}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.WebSockets;
using Microsoft.Extensions.Logging;
using RemoteAgent.Network.Protocol;

namespace RemoteAgent.Platform.Screen;

public class ScreenStreamCoordinator : IDisposable
{
    private readonly ILogger<ScreenStreamCoordinator> _logger;
    private readonly IScreenCaptureEngine _captureEngine;
    private readonly ConcurrentDictionary<string, ClientStreamSession> _sessions = new();
    private readonly object _loopLock = new();

    private CancellationTokenSource? _captureCts;
    private Task? _captureTask;
    private System.Threading.Timer? _telemetryTimer;
    private uint _sequenceCounter = 0;

    public event Action<string, ScreenTelemetryPayload>? TelemetryUpdated;

    public ScreenStreamCoordinator(ILogger<ScreenStreamCoordinator> logger, IScreenCaptureEngine captureEngine)
    {
        _logger = logger;
        _captureEngine = captureEngine;
    }

    public void StartStream(string connectionId, Func<byte[], CancellationToken, Task<bool>> sendFrame, ScreenStartPayload config)
    {
        lock (_loopLock)
        {
            // If session already exists, update config
            if (_sessions.TryGetValue(connectionId, out var existing))
            {
                existing.UpdateConfig(config);
                _logger.LogInformation("Updated screen stream config for {ConnectionId}: FPS={Fps}, Q={Q}, Scale={Scale}", 
                    connectionId, config.Fps, config.Quality, config.Scale);
                return;
            }

            var session = new ClientStreamSession(connectionId, sendFrame, config);
            _sessions[connectionId] = session;

            _logger.LogInformation("Started screen stream for {ConnectionId}: FPS={Fps}, Q={Q}, Scale={Scale}, Monitor={Monitor}", 
                connectionId, config.Fps, config.Quality, config.Scale, config.MonitorIndex);

            // Start sender task for this client
            session.SenderTask = Task.Run(() => ClientSenderLoopAsync(session, session.Cts.Token));

            // Ensure master capture loop is running
            EnsureCaptureLoopRunning();
        }
    }

    public void StopStream(string connectionId)
    {
        lock (_loopLock)
        {
            if (_sessions.TryRemove(connectionId, out var session))
            {
                session.Dispose();
                _logger.LogInformation("Stopped screen stream for {ConnectionId}", connectionId);
            }

            if (_sessions.IsEmpty)
            {
                StopCaptureLoop();
            }
        }
    }

    public CapturedFrame? CaptureSnapshot(int monitorIndex = 0, float scale = 1.0f, int quality = 85)
    {
        return _captureEngine.CaptureFrame(monitorIndex, scale, quality, unchecked(++_sequenceCounter));
    }

    public List<ScreenMonitorInfo> GetMonitors() => _captureEngine.GetMonitors();

    private void EnsureCaptureLoopRunning()
    {
        if (_captureTask == null || _captureTask.IsCompleted)
        {
            _captureCts = new CancellationTokenSource();
            _captureTask = Task.Run(() => MasterCaptureLoopAsync(_captureCts.Token));
            _telemetryTimer = new System.Threading.Timer(OnTelemetryTick, null, 1000, 1000);
            _logger.LogInformation("Master screen capture loop started.");
        }
    }

    private void StopCaptureLoop()
    {
        try
        {
            _telemetryTimer?.Dispose();
            _telemetryTimer = null;

            if (_captureCts != null)
            {
                _captureCts.Cancel();
                _captureCts.Dispose();
                _captureCts = null;
            }
            _captureTask = null;
            _logger.LogInformation("Master screen capture loop stopped (zero idle overhead).");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error stopping master capture loop");
        }
    }

    private async Task MasterCaptureLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && !_sessions.IsEmpty)
        {
            try
            {
                // Find highest target FPS among active sessions to drive capture rate
                int targetFps = 10;
                foreach (var s in _sessions.Values)
                {
                    if (s.Config.Fps > targetFps) targetFps = s.Config.Fps;
                }
                targetFps = Math.Clamp(targetFps, 1, 30);
                int frameIntervalMs = 1000 / targetFps;

                var loopStart = Stopwatch.StartNew();

                // Capture each unique configuration needed
                // Group by (MonitorIndex, Scale, Quality) so we don't encode duplicate bitmaps if multiple clients want identical config
                var groups = _sessions.Values
                    .GroupBy(s => (s.Config.MonitorIndex, s.Config.Scale, s.Config.Quality))
                    .ToList();

                foreach (var group in groups)
                {
                    var (monIdx, scale, quality) = group.Key;
                    var seq = unchecked(++_sequenceCounter);

                    var frame = _captureEngine.CaptureFrame(monIdx, scale, quality, seq);
                    if (frame == null) continue;

                    var packedPacket = BinaryFrameHeader.Pack(frame);

                    foreach (var session in group)
                    {
                        session.PostLatestFrame(packedPacket, frame.CaptureDurationMs);
                    }
                }

                loopStart.Stop();
                int elapsed = (int)loopStart.ElapsedMilliseconds;
                int delay = Math.Max(1, frameIntervalMs - elapsed);

                await Task.Delay(delay, ct);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Exception in master capture loop");
                await Task.Delay(50, ct);
            }
        }
    }

    private async Task ClientSenderLoopAsync(ClientStreamSession session, CancellationToken ct)
    {
        var sendSw = new Stopwatch();
        int consecutiveFailures = 0;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                await session.Signal.WaitAsync(ct);

                // Atomic pop: Grab the newest frame slot
                var packet = Interlocked.Exchange(ref session.LatestUnsentPacket, null);
                if (packet == null) continue;

                sendSw.Restart();
                bool sent = await session.SendFrameAsync(packet, ct);
                sendSw.Stop();

                if (!sent)
                {
                    consecutiveFailures++;
                    session.RecordDropped();
                    if (consecutiveFailures >= 5)
                    {
                        _logger.LogWarning("Sender loop terminating for {ConnectionId}: 5 consecutive send failures.", session.ConnectionId);
                        break;
                    }
                    continue;
                }

                consecutiveFailures = 0;
                session.RecordSent(packet.Length, sendSw.ElapsedMilliseconds);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning("Sender loop terminating for {ConnectionId}: {Msg}", session.ConnectionId, ex.Message);
                break;
            }
        }

        StopStream(session.ConnectionId);
    }

    private void OnTelemetryTick(object? state)
    {
        foreach (var session in _sessions.Values)
        {
            var telemetry = session.ComputeTelemetry();
            TelemetryUpdated?.Invoke(session.ConnectionId, telemetry);
        }
    }

    public void Dispose()
    {
        StopCaptureLoop();
        foreach (var s in _sessions.Values)
        {
            s.Dispose();
        }
        _sessions.Clear();
        _captureEngine.Dispose();
    }
}

public class ClientStreamSession : IDisposable
{
    public string ConnectionId { get; }
    public Func<byte[], CancellationToken, Task<bool>> SendFrameAsync { get; }
    public ScreenStartPayload Config { get; private set; }
    public CancellationTokenSource Cts { get; } = new();
    public SemaphoreSlim Signal { get; } = new(0, 1);
    public Task? SenderTask { get; set; }

    public byte[]? LatestUnsentPacket;

    // Telemetry Tracking
    private int _framesSentInterval;
    private int _framesDroppedInterval;
    private long _bytesSentInterval;
    private long _lastCaptureDurationMs;
    private long _lastSendDurationMs;

    public ClientStreamSession(string connectionId, Func<byte[], CancellationToken, Task<bool>> sendFrame, ScreenStartPayload config)
    {
        ConnectionId = connectionId;
        SendFrameAsync = sendFrame;
        Config = config;
    }

    public void UpdateConfig(ScreenStartPayload newConfig)
    {
        Config = newConfig;
    }

    public void PostLatestFrame(byte[] packet, long captureDurationMs)
    {
        _lastCaptureDurationMs = captureDurationMs;

        // Latest frame swap: Drop any previously unconsumed frame
        var old = Interlocked.Exchange(ref LatestUnsentPacket, packet);
        if (old != null)
        {
            Interlocked.Increment(ref _framesDroppedInterval);
        }

        // Release signal if not already signaled
        if (Signal.CurrentCount == 0)
        {
            try
            {
                Signal.Release();
            }
            catch (SemaphoreFullException) { }
        }
    }

    public void RecordSent(int bytes, long sendDurationMs)
    {
        Interlocked.Increment(ref _framesSentInterval);
        Interlocked.Add(ref _bytesSentInterval, bytes);
        _lastSendDurationMs = sendDurationMs;
    }

    public void RecordDropped()
    {
        Interlocked.Increment(ref _framesDroppedInterval);
    }

    public ScreenTelemetryPayload ComputeTelemetry()
    {
        int fps = Interlocked.Exchange(ref _framesSentInterval, 0);
        int dropped = Interlocked.Exchange(ref _framesDroppedInterval, 0);
        long bytesSec = Interlocked.Exchange(ref _bytesSentInterval, 0);

        double mbMin = (bytesSec * 60.0) / (1024.0 * 1024.0);
        double gbHour = (mbMin * 60.0) / 1024.0;

        return new ScreenTelemetryPayload
        {
            ActualFps = fps,
            DroppedFrames = dropped,
            BytesPerSecond = bytesSec,
            EstimatedMbPerMinute = Math.Round(mbMin, 2),
            EstimatedGbPerHour = Math.Round(gbHour, 3),
            QueueDepth = LatestUnsentPacket != null ? 1 : 0,
            CaptureDurationMs = _lastCaptureDurationMs,
            SendDurationMs = _lastSendDurationMs
        };
    }

    public void Dispose()
    {
        Cts.Cancel();
        Cts.Dispose();
        Signal.Dispose();
    }
}

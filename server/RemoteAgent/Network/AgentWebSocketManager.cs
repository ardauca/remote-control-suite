using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RemoteAgent.Configuration;
using RemoteAgent.Core;
using RemoteAgent.Network.Protocol;
using RemoteAgent.Platform.Audio;
using RemoteAgent.Platform.Input;
using RemoteAgent.Platform.Media;

namespace RemoteAgent.Network;

public class AgentWebSocketManager
{
    private readonly ILogger<AgentWebSocketManager> _logger;
    private readonly AgentOptions _options;
    private readonly IInputSimulator _inputSimulator;
    private readonly IAudioManager _audioManager;
    private readonly IMediaManager _mediaManager;
    private readonly Platform.SystemControl.ISystemControlManager _systemControlManager;
    private readonly Platform.Screen.ScreenStreamCoordinator _screenCoordinator;
    private readonly Platform.Screen.IScreenCaptureEngine _screenCaptureEngine;
    private readonly ConcurrentDictionary<string, WebSocket> _activeSockets = new();
    private readonly ConcurrentDictionary<string, bool> _authenticatedConnections = new();
    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public event Action<int>? ActiveConnectionsChanged;

    public AgentWebSocketManager(
        ILogger<AgentWebSocketManager> logger, 
        IOptions<AgentOptions> options,
        IInputSimulator inputSimulator,
        IAudioManager audioManager,
        IMediaManager mediaManager,
        Platform.SystemControl.ISystemControlManager systemControlManager,
        Platform.Screen.ScreenStreamCoordinator screenCoordinator,
        Platform.Screen.IScreenCaptureEngine screenCaptureEngine)
    {
        _logger = logger;
        _options = options.Value;
        _inputSimulator = inputSimulator;
        _audioManager = audioManager;
        _mediaManager = mediaManager;
        _systemControlManager = systemControlManager;
        _screenCoordinator = screenCoordinator;
        _screenCaptureEngine = screenCaptureEngine;

        // Broadcast real-time volume state changes to all connected iPhones
        _audioManager.VolumeChanged += state =>
        {
            var envelope = MessageEnvelope<VolumeStatePayload>.Create("event", ActionTypes.VolumeState, state);
            _ = BroadcastAsync(envelope);
        };

        // Broadcast real-time now-playing changes to all connected iPhones
        _mediaManager.NowPlayingChanged += meta =>
        {
            var envelope = MessageEnvelope<MediaNowPlayingPayload>.Create("event", ActionTypes.MediaNowPlaying, meta);
            _ = BroadcastAsync(envelope);
        };

        // Broadcast real-time power/shutdown timer changes to all connected iPhones
        _systemControlManager.ShutdownStatusChanged += status =>
        {
            var envelope = MessageEnvelope<PowerStatusPayload>.Create("event", ActionTypes.PowerStatus, status);
            _ = BroadcastAsync(envelope);
        };

        // Send screen telemetry updates to active streaming clients
        _screenCoordinator.TelemetryUpdated += (connId, telemetry) =>
        {
            if (_activeSockets.TryGetValue(connId, out var sock) && sock.State == WebSocketState.Open)
            {
                var envelope = MessageEnvelope<ScreenTelemetryPayload>.Create("event", ActionTypes.ScreenTelemetry, telemetry);
                _ = SendJsonAsync(sock, envelope, CancellationToken.None);
            }
        };
    }

    public int ActiveConnectionCount => _activeSockets.Count;

    public async Task HandleConnectionAsync(HttpContext context, WebSocket webSocket)
    {
        var connectionId = Guid.NewGuid().ToString("N");
        var clientIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";

        _activeSockets.TryAdd(connectionId, webSocket);
        _logger.LogInformation("WebSocket client connected. ID: {ConnectionId}, IP: {ClientIp}", connectionId, clientIp);
        ActiveConnectionsChanged?.Invoke(_activeSockets.Count);

        bool isAuth = string.IsNullOrEmpty(_options.AuthToken) ||
                      (context.Request.Query.TryGetValue("token", out var tokenVal) && tokenVal.ToString() == _options.AuthToken);
        _authenticatedConnections[connectionId] = isAuth;

        try
        {
            // 1. Send system.hello immediately
            var helloPayload = new ServerHelloPayload
            {
                ServerName = _options.ServerName,
                Version = "1.0.0",
                Os = SystemInfoHelper.GetOsDescription(),
                Capabilities = SystemInfoHelper.GetCapabilities()
            };
            var helloEnvelope = MessageEnvelope<ServerHelloPayload>.Create("event", ActionTypes.SystemHello, helloPayload);
            await SendJsonAsync(webSocket, helloEnvelope, CancellationToken.None);

            // 2. Send initial volume and media states
            var initialVol = _audioManager.GetVolumeState();
            await SendJsonAsync(webSocket, MessageEnvelope<VolumeStatePayload>.Create("event", ActionTypes.VolumeState, initialVol), CancellationToken.None);

            var initialMedia = await _mediaManager.GetNowPlayingAsync();
            await SendJsonAsync(webSocket, MessageEnvelope<MediaNowPlayingPayload>.Create("event", ActionTypes.MediaNowPlaying, initialMedia), CancellationToken.None);

            var initialPower = _systemControlManager.GetCurrentPowerStatus();
            await SendJsonAsync(webSocket, MessageEnvelope<PowerStatusPayload>.Create("event", ActionTypes.PowerStatus, initialPower), CancellationToken.None);

            // 2. Read loop
            var buffer = new byte[1024 * 16]; // 16 KB buffer
            while (webSocket.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close)
                    {
                        break;
                    }
                    ms.Write(buffer, 0, result.Count);
                }
                while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("Client requested close. ID: {ConnectionId}", connectionId);
                    await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text)
                {
                    ms.Seek(0, SeekOrigin.Begin);
                    using var reader = new StreamReader(ms, Encoding.UTF8);
                    var messageJson = await reader.ReadToEndAsync();
                    await ProcessMessageAsync(webSocket, connectionId, messageJson);
                }
            }
        }
        catch (WebSocketException ex)
        {
            _logger.LogWarning("WebSocket disconnected: {Message} (ID: {ConnectionId})", ex.Message, connectionId);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling WebSocket client. ID: {ConnectionId}", connectionId);
        }
        finally
        {
            _activeSockets.TryRemove(connectionId, out _);
            _authenticatedConnections.TryRemove(connectionId, out _);
            _screenCoordinator.StopStream(connectionId);
            _inputSimulator.ReleaseConnectionKeys(connectionId);
            if (_activeSockets.IsEmpty)
            {
                _inputSimulator.ReleaseAllKeys();
            }
            _logger.LogInformation("WebSocket client removed. ID: {ConnectionId}. Remaining: {Count}", connectionId, _activeSockets.Count);
            ActiveConnectionsChanged?.Invoke(_activeSockets.Count);

            if (webSocket.State == WebSocketState.Open || webSocket.State == WebSocketState.CloseReceived)
            {
                try
                {
                    await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Session ended", CancellationToken.None);
                }
                catch
                {
                    // Ignore during cleanup
                }
            }
            webSocket.Dispose();
        }
    }

    private async Task ProcessMessageAsync(WebSocket webSocket, string connectionId, string rawJson)
    {
        try
        {
            using var doc = JsonDocument.Parse(rawJson);
            var root = doc.RootElement;

            if (!root.TryGetProperty("action", out var actionProp))
            {
                _logger.LogWarning("Received message without 'action' property: {Json}", rawJson);
                return;
            }

            var action = actionProp.GetString();
            switch (action)
            {
                case ActionTypes.SystemPing:
                    long clientTime = 0;
                    if (root.TryGetProperty("payload", out var payloadProp) &&
                        payloadProp.TryGetProperty("clientTime", out var clientTimeProp))
                    {
                        clientTime = clientTimeProp.GetInt64();
                    }

                    var pong = new PongPayload
                    {
                        ClientTime = clientTime,
                        ServerTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    };
                    var pongEnvelope = MessageEnvelope<PongPayload>.Create("heartbeat", ActionTypes.SystemPong, pong);
                    await SendJsonAsync(webSocket, pongEnvelope, CancellationToken.None);
                    break;

                case ActionTypes.MouseMove:
                    if (root.TryGetProperty("payload", out var movePayload))
                    {
                        int dx = movePayload.TryGetProperty("dx", out var dxProp) ? dxProp.GetInt32() : 0;
                        int dy = movePayload.TryGetProperty("dy", out var dyProp) ? dyProp.GetInt32() : 0;
                        _inputSimulator.MoveMouseRelative(dx, dy);
                    }
                    break;

                case ActionTypes.MouseClick:
                    if (root.TryGetProperty("payload", out var clickPayload))
                    {
                        var btn = clickPayload.TryGetProperty("button", out var btnProp) ? btnProp.GetString() ?? "left" : "left";
                        bool isDouble = clickPayload.TryGetProperty("double", out var doubleProp) && doubleProp.GetBoolean();
                        _inputSimulator.MouseClick(btn, isDouble);
                    }
                    break;

                case "mouse.down":
                    if (root.TryGetProperty("payload", out var downPayload))
                    {
                        var btn = downPayload.TryGetProperty("button", out var btnProp) ? btnProp.GetString() ?? "left" : "left";
                        _inputSimulator.MouseDown(btn);
                    }
                    break;

                case "mouse.up":
                    if (root.TryGetProperty("payload", out var upPayload))
                    {
                        var btn = upPayload.TryGetProperty("button", out var btnProp) ? btnProp.GetString() ?? "left" : "left";
                        _inputSimulator.MouseUp(btn);
                    }
                    break;

                case "mouse.scroll":
                    if (root.TryGetProperty("payload", out var scrollPayload))
                    {
                        int dx = scrollPayload.TryGetProperty("dx", out var dxProp) ? dxProp.GetInt32() : 0;
                        int dy = scrollPayload.TryGetProperty("dy", out var dyProp) ? dyProp.GetInt32() : 0;
                        _inputSimulator.MouseScroll(dx, dy);
                    }
                    break;

                case ActionTypes.KeyboardText:
                    if (root.TryGetProperty("payload", out var textPayload) &&
                        textPayload.TryGetProperty("text", out var textProp))
                    {
                        var text = textProp.GetString();
                        if (!string.IsNullOrEmpty(text))
                        {
                            // Security: Enforce max 2000 chars per text packet
                            if (text.Length > 2000)
                            {
                                _logger.LogWarning("Oversized text payload ({Length} chars) rejected from {ConnectionId}", text.Length, connectionId);
                                var err = new ErrorPayload { Code = "PAYLOAD_TOO_LARGE", Message = "Text payload exceeds 2000 characters limit" };
                                await SendJsonAsync(webSocket, MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err), CancellationToken.None);
                                return;
                            }
                            _inputSimulator.SendText(text);
                        }
                    }
                    break;

                case ActionTypes.KeyboardKeyDown:
                    if (root.TryGetProperty("payload", out var keyDownPayload) &&
                        keyDownPayload.TryGetProperty("key", out var downKeyProp))
                    {
                        var key = downKeyProp.GetString()?.Trim();
                        if (!string.IsNullOrEmpty(key))
                        {
                            if (!_inputSimulator.IsValidKey(key))
                            {
                                _logger.LogWarning("Invalid or unmapped key '{Key}' rejected for KeyDown from {ConnectionId}", key, connectionId);
                                var err = new ErrorPayload { Code = "INVALID_KEY", Message = $"Key '{key}' is not mapped or recognized" };
                                await SendJsonAsync(webSocket, MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err), CancellationToken.None);
                                return;
                            }
                            _inputSimulator.KeyDown(key, connectionId);
                        }
                    }
                    break;

                case ActionTypes.KeyboardKeyUp:
                    if (root.TryGetProperty("payload", out var keyUpPayload) &&
                        keyUpPayload.TryGetProperty("key", out var upKeyProp))
                    {
                        var key = upKeyProp.GetString()?.Trim();
                        if (!string.IsNullOrEmpty(key))
                        {
                            _inputSimulator.KeyUp(key, connectionId);
                        }
                    }
                    break;

                case ActionTypes.KeyboardShortcut:
                    if (root.TryGetProperty("payload", out var shortcutPayload) &&
                        shortcutPayload.TryGetProperty("keys", out var keysArrayProp) &&
                        keysArrayProp.ValueKind == JsonValueKind.Array)
                    {
                        var keys = new List<string>();
                        foreach (var k in keysArrayProp.EnumerateArray())
                        {
                            var s = k.GetString()?.Trim();
                            if (!string.IsNullOrEmpty(s)) keys.Add(s);
                        }

                        if (keys.Count > 8)
                        {
                            _logger.LogWarning("Shortcut keys count exceeded ({Count} keys) from {ConnectionId}", keys.Count, connectionId);
                            var err = new ErrorPayload { Code = "INVALID_SHORTCUT", Message = "Shortcut exceeds 8 keys limit" };
                            await SendJsonAsync(webSocket, MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err), CancellationToken.None);
                            return;
                        }

                        if (keys.Any(k => !_inputSimulator.IsValidKey(k)))
                        {
                            _logger.LogWarning("Shortcut contains unrecognized key from {ConnectionId}", connectionId);
                            var err = new ErrorPayload { Code = "INVALID_KEY", Message = "Shortcut contains unmapped key" };
                            await SendJsonAsync(webSocket, MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err), CancellationToken.None);
                            return;
                        }

                        if (keys.Count > 0)
                        {
                            _inputSimulator.ExecuteShortcut(keys.ToArray());
                        }
                    }
                    break;

                case ActionTypes.KeyboardReleaseAll:
                    _inputSimulator.ReleaseConnectionKeys(connectionId);
                    break;

                // Volume & Audio Mixer (Phase 5)
                case ActionTypes.VolumeRequestState:
                    var currentVolState = _audioManager.GetVolumeState();
                    await SendJsonAsync(webSocket, MessageEnvelope<VolumeStatePayload>.Create("event", ActionTypes.VolumeState, currentVolState), CancellationToken.None);
                    break;

                case ActionTypes.VolumeSetMaster:
                    if (root.TryGetProperty("payload", out var setMasterPayload))
                    {
                        if (setMasterPayload.TryGetProperty("volume", out var volProp))
                        {
                            _audioManager.SetMasterVolume((float)volProp.GetDouble());
                        }
                        if (setMasterPayload.TryGetProperty("mute", out var muteProp))
                        {
                            _audioManager.SetMasterMute(muteProp.GetBoolean());
                        }
                    }
                    break;

                case ActionTypes.VolumeSetSession:
                    if (root.TryGetProperty("payload", out var setSessionPayload))
                    {
                        var sessionId = setSessionPayload.TryGetProperty("sessionId", out var idProp) ? idProp.GetString() ?? "" : "";
                        if (setSessionPayload.TryGetProperty("volume", out var volProp))
                        {
                            _audioManager.SetSessionVolume(sessionId, (float)volProp.GetDouble());
                        }
                        if (setSessionPayload.TryGetProperty("mute", out var muteProp))
                        {
                            _audioManager.SetSessionMute(sessionId, muteProp.GetBoolean());
                        }
                    }
                    break;

                // Media Control (Phase 5)
                case ActionTypes.MediaRequestNowPlaying:
                    var nowPlaying = await _mediaManager.GetNowPlayingAsync();
                    await SendJsonAsync(webSocket, MessageEnvelope<MediaNowPlayingPayload>.Create("event", ActionTypes.MediaNowPlaying, nowPlaying), CancellationToken.None);
                    break;

                case ActionTypes.MediaAction:
                    if (root.TryGetProperty("payload", out var mediaPayload) &&
                        mediaPayload.TryGetProperty("action", out var mediaActionProp))
                    {
                        var act = mediaActionProp.GetString();
                        if (!string.IsNullOrEmpty(act))
                        {
                            await _mediaManager.ExecuteMediaActionAsync(act);
                        }
                    }
                    break;

                // Power & System Controls (Phase 6)
                case ActionTypes.PowerRequestStatus:
                    var powerStatus = _systemControlManager.GetCurrentPowerStatus();
                    await SendJsonAsync(webSocket, MessageEnvelope<PowerStatusPayload>.Create("event", ActionTypes.PowerStatus, powerStatus), CancellationToken.None);
                    break;

                case ActionTypes.PowerAction:
                    if (root.TryGetProperty("payload", out var powerPayload) &&
                        powerPayload.TryGetProperty("action", out var pActionProp))
                    {
                        var act = pActionProp.GetString();
                        switch (act?.ToLowerInvariant())
                        {
                            case "lock":
                                _systemControlManager.LockWorkstation();
                                break;
                            case "sleep":
                                _systemControlManager.Sleep();
                                break;
                            case "displayoff":
                                _systemControlManager.TurnOffDisplay();
                                break;
                            case "taskmanager":
                                _systemControlManager.OpenTaskManager();
                                break;
                            case "showdesktop":
                                _systemControlManager.ToggleDesktop();
                                break;
                            case "taskview":
                                _systemControlManager.OpenTaskView();
                                break;
                            case "screenshot":
                                _systemControlManager.TakeScreenshot();
                                break;
                            case "shutdown":
                                _systemControlManager.ShutdownNow();
                                break;
                            case "restart":
                                _systemControlManager.RestartNow();
                                break;
                            default:
                                _logger.LogWarning("Unknown power action requested: {Action}", act);
                                break;
                        }
                    }
                    break;

                case ActionTypes.PowerSchedule:
                    if (root.TryGetProperty("payload", out var schedulePayload))
                    {
                        var schedAction = schedulePayload.TryGetProperty("action", out var schedActProp) ? schedActProp.GetString() ?? "shutdown" : "shutdown";
                        var timeoutSeconds = schedulePayload.TryGetProperty("timeoutSeconds", out var secProp) ? secProp.GetInt32() : 1800;
                        if (timeoutSeconds <= 0) timeoutSeconds = 60;

                        if (schedAction.Equals("restart", StringComparison.OrdinalIgnoreCase))
                        {
                            _systemControlManager.ScheduleRestart(timeoutSeconds);
                        }
                        else
                        {
                            _systemControlManager.ScheduleShutdown(timeoutSeconds);
                        }
                    }
                    break;

                case ActionTypes.PowerCancel:
                    if (!IsAuthorized(connectionId)) { await SendUnauthorizedAsync(webSocket); return; }
                    _systemControlManager.CancelScheduledShutdown();
                    break;

                // Auth & Pairing (WAN Security)
                case ActionTypes.AuthLogin:
                    if (root.TryGetProperty("payload", out var loginPayload) &&
                        loginPayload.TryGetProperty("token", out var tokenProp))
                    {
                        var clientToken = tokenProp.GetString();
                        bool ok = string.IsNullOrEmpty(_options.AuthToken) || clientToken == _options.AuthToken;
                        _authenticatedConnections[connectionId] = ok;
                        var res = new AuthResultPayload
                        {
                            Authenticated = ok,
                            Message = ok ? "Authentication successful" : "Invalid auth token"
                        };
                        await SendJsonAsync(webSocket, MessageEnvelope<AuthResultPayload>.Create("response", ActionTypes.AuthResult, res), CancellationToken.None);
                    }
                    break;

                // Screen Mirroring & Stream (Phase 7)
                case ActionTypes.ScreenStart:
                    if (!IsAuthorized(connectionId)) { await SendUnauthorizedAsync(webSocket); return; }
                    var cfg = new ScreenStartPayload();
                    if (root.TryGetProperty("payload", out var sStartPayload))
                    {
                        if (sStartPayload.TryGetProperty("fps", out var fpsP)) cfg.Fps = fpsP.GetInt32();
                        if (sStartPayload.TryGetProperty("quality", out var qP)) cfg.Quality = qP.GetInt32();
                        if (sStartPayload.TryGetProperty("scale", out var scP)) cfg.Scale = (float)scP.GetDouble();
                        if (sStartPayload.TryGetProperty("monitorIndex", out var monP)) cfg.MonitorIndex = monP.GetInt32();
                    }
                    _screenCoordinator.StartStream(connectionId, webSocket, cfg);
                    break;

                case ActionTypes.ScreenStop:
                    _screenCoordinator.StopStream(connectionId);
                    break;

                case ActionTypes.ScreenSnapshot:
                    if (!IsAuthorized(connectionId)) { await SendUnauthorizedAsync(webSocket); return; }
                    int monIdx = 0;
                    float snapScale = 1.0f;
                    int snapQuality = 85;
                    if (root.TryGetProperty("payload", out var snapPayload))
                    {
                        if (snapPayload.TryGetProperty("monitorIndex", out var mP)) monIdx = mP.GetInt32();
                        if (snapPayload.TryGetProperty("scale", out var sP)) snapScale = (float)sP.GetDouble();
                        if (snapPayload.TryGetProperty("quality", out var qP)) snapQuality = qP.GetInt32();
                    }
                    var snapFrame = _screenCoordinator.CaptureSnapshot(monIdx, snapScale, snapQuality);
                    if (snapFrame != null)
                    {
                        var packet = Platform.Screen.BinaryFrameHeader.Pack(snapFrame);
                        await webSocket.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, CancellationToken.None);
                    }
                    break;

                case ActionTypes.ScreenTouch:
                    if (!IsAuthorized(connectionId)) { await SendUnauthorizedAsync(webSocket); return; }
                    if (root.TryGetProperty("payload", out var touchPayload))
                    {
                        float normX = touchPayload.TryGetProperty("normX", out var nxP) ? (float)nxP.GetDouble() : 0.5f;
                        float normY = touchPayload.TryGetProperty("normY", out var nyP) ? (float)nyP.GetDouble() : 0.5f;
                        string tType = touchPayload.TryGetProperty("type", out var ttP) ? ttP.GetString() ?? "click" : "click";
                        string tBtn = touchPayload.TryGetProperty("button", out var tbP) ? tbP.GetString() ?? "left" : "left";

                        var screens = System.Windows.Forms.Screen.AllScreens;
                        var targetScreen = screens.Length > 0 ? screens[0] : null;
                        if (targetScreen != null)
                        {
                            int absX = targetScreen.Bounds.X + (int)Math.Round(normX * targetScreen.Bounds.Width);
                            int absY = targetScreen.Bounds.Y + (int)Math.Round(normY * targetScreen.Bounds.Height);

                            _inputSimulator.MoveMouseAbsolute(absX, absY);

                            switch (tType.ToLowerInvariant())
                            {
                                case "click":
                                    _inputSimulator.MouseClick(tBtn, false);
                                    break;
                                case "double":
                                    _inputSimulator.MouseClick(tBtn, true);
                                    break;
                                case "right":
                                    _inputSimulator.MouseClick("right", false);
                                    break;
                                case "down":
                                    _inputSimulator.MouseDown(tBtn);
                                    break;
                                case "up":
                                    _inputSimulator.MouseUp(tBtn);
                                    break;
                                case "move":
                                    // position already updated
                                    break;
                            }
                        }
                    }
                    break;

                case ActionTypes.ScreenMonitors:
                    var monitors = _screenCaptureEngine.GetMonitors();
                    await SendJsonAsync(webSocket, MessageEnvelope<List<Platform.Screen.ScreenMonitorInfo>>.Create("response", ActionTypes.ScreenMonitors, monitors), CancellationToken.None);
                    break;

                default:
                    _logger.LogInformation("Unhandled protocol action received: {Action}", action);
                    break;
            }
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse incoming WebSocket JSON message: {Raw}", rawJson);
            var err = new ErrorPayload
            {
                Code = "BAD_REQUEST",
                Message = "Malformed JSON message"
            };
            var errEnvelope = MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err);
            await SendJsonAsync(webSocket, errEnvelope, CancellationToken.None);
        }
    }

    public async Task SendJsonAsync<T>(WebSocket socket, MessageEnvelope<T> envelope, CancellationToken cancellationToken)
    {
        if (socket.State != WebSocketState.Open)
        {
            return;
        }

        var json = JsonSerializer.Serialize(envelope, _jsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        await socket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellationToken);
    }

    public async Task BroadcastAsync<T>(MessageEnvelope<T> envelope, CancellationToken cancellationToken = default)
    {
        var tasks = _activeSockets.Values
            .Where(s => s.State == WebSocketState.Open)
            .Select(s => SendJsonAsync(s, envelope, cancellationToken));
        await Task.WhenAll(tasks);
    }

    private bool IsAuthorized(string connectionId)
    {
        if (string.IsNullOrEmpty(_options.AuthToken)) return true;
        return _authenticatedConnections.TryGetValue(connectionId, out var auth) && auth;
    }

    private Task SendUnauthorizedAsync(WebSocket socket)
    {
        var err = new ErrorPayload
        {
            Code = "UNAUTHORIZED",
            Message = "Authentication required for this operation"
        };
        return SendJsonAsync(socket, MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err), CancellationToken.None);
    }
}

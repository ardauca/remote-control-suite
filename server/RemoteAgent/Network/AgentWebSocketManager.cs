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
using RemoteAgent.Security;

namespace RemoteAgent.Network;

public class AgentWebSocketManager
{
    private readonly ILogger<AgentWebSocketManager> _logger;
    private readonly AgentOptions _options;
    private readonly PairingManager _pairingManager;
    private readonly IInputSimulator _inputSimulator;
    private readonly IAudioManager _audioManager;
    private readonly IMediaManager _mediaManager;
    private readonly Platform.SystemControl.ISystemControlManager _systemControlManager;
    private readonly Platform.Screen.ScreenStreamCoordinator _screenCoordinator;
    private readonly Platform.Screen.IScreenCaptureEngine _screenCaptureEngine;

    private readonly ConcurrentDictionary<string, ActiveConnection> _connections = new();
    private readonly ConcurrentDictionary<string, ClientSessionInfo> _sessions = new();

    private readonly JsonSerializerOptions _jsonOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    public event Action<int>? ActiveConnectionsChanged;

    public sealed class ClientSessionInfo
    {
        public string ConnectionId { get; }
        public string ClientIp { get; }
        public bool IsAuthenticated { get; set; }
        public string? DeviceId { get; set; }
        public string? DeviceName { get; set; }
        public HashSet<string> Capabilities { get; } = new(StringComparer.OrdinalIgnoreCase);
        public ConnectionRateLimiter RateLimiter { get; } = new();

        public ClientSessionInfo(string connectionId, string clientIp)
        {
            ConnectionId = connectionId;
            ClientIp = clientIp;
        }
    }

    public AgentWebSocketManager(
        ILogger<AgentWebSocketManager> logger, 
        IOptions<AgentOptions> options,
        PairingManager pairingManager,
        IInputSimulator inputSimulator,
        IAudioManager audioManager,
        IMediaManager mediaManager,
        Platform.SystemControl.ISystemControlManager systemControlManager,
        Platform.Screen.ScreenStreamCoordinator screenCoordinator,
        Platform.Screen.IScreenCaptureEngine screenCaptureEngine)
    {
        _logger = logger;
        _options = options.Value;
        _pairingManager = pairingManager;
        _inputSimulator = inputSimulator;
        _audioManager = audioManager;
        _mediaManager = mediaManager;
        _systemControlManager = systemControlManager;
        _screenCoordinator = screenCoordinator;
        _screenCaptureEngine = screenCaptureEngine;

        // Broadcast real-time volume state changes to authenticated clients only
        _audioManager.VolumeChanged += state =>
        {
            var envelope = MessageEnvelope<VolumeStatePayload>.Create("event", ActionTypes.VolumeState, state);
            _ = BroadcastToAuthenticatedAsync(envelope, SecurityCapabilities.VolumeControl);
        };

        // Broadcast real-time now-playing changes to authenticated clients only
        _mediaManager.NowPlayingChanged += meta =>
        {
            var envelope = MessageEnvelope<MediaNowPlayingPayload>.Create("event", ActionTypes.MediaNowPlaying, meta);
            _ = BroadcastToAuthenticatedAsync(envelope, SecurityCapabilities.MediaControl);
        };

        // Broadcast real-time power/shutdown timer changes to authenticated clients only
        _systemControlManager.ShutdownStatusChanged += status =>
        {
            var envelope = MessageEnvelope<PowerStatusPayload>.Create("event", ActionTypes.PowerStatus, status);
            _ = BroadcastToAuthenticatedAsync(envelope, SecurityCapabilities.PowerControl);
        };

        // Send screen telemetry updates to active streaming clients
        _screenCoordinator.TelemetryUpdated += (connId, telemetry) =>
        {
            if (_connections.TryGetValue(connId, out var conn) && conn.Socket.State == WebSocketState.Open)
            {
                var envelope = MessageEnvelope<ScreenTelemetryPayload>.Create("event", ActionTypes.ScreenTelemetry, telemetry);
                _ = SendJsonAsync(conn, envelope, CancellationToken.None);
            }
        };
    }

    public int ActiveConnectionCount => _connections.Count;
    public int AuthenticatedConnectionCount => _sessions.Values.Count(s => s.IsAuthenticated);

    public async Task HandleConnectionAsync(HttpContext context, WebSocket webSocket)
    {
        var connectionId = Guid.NewGuid().ToString("N");
        var clientIp = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        var activeConn = new ActiveConnection(connectionId, webSocket);
        var session = new ClientSessionInfo(connectionId, clientIp);

        _connections.TryAdd(connectionId, activeConn);
        _sessions.TryAdd(connectionId, session);

        _logger.LogInformation("WebSocket client connected. ID: {ConnectionId}, IP: {ClientIp}", connectionId, clientIp);
        ActiveConnectionsChanged?.Invoke(_connections.Count);

        // Check if a valid token was passed during handshake (e.g. from saved credentials)
        if (context.Request.Query.TryGetValue("token", out var tokenVal))
        {
            var tokenStr = tokenVal.ToString();
            if (_pairingManager.ValidateToken(tokenStr, out var pairedDevice))
            {
                session.IsAuthenticated = true;
                session.DeviceId = pairedDevice!.DeviceId;
                session.DeviceName = pairedDevice.DeviceName;
                session.Capabilities.Clear();
                foreach (var c in pairedDevice.Capabilities) session.Capabilities.Add(c);
                _logger.LogInformation("Client {ConnectionId} authenticated via handshake token ({DeviceName})", connectionId, session.DeviceName);
            }
            else if (!string.IsNullOrEmpty(_options.AuthToken) && tokenStr == _options.AuthToken)
            {
                session.IsAuthenticated = true;
                session.DeviceId = "legacy";
                session.DeviceName = "Configured Token";
                session.Capabilities.Clear();
                foreach (var c in SecurityCapabilities.All) session.Capabilities.Add(c);
            }
        }

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
            await SendJsonAsync(activeConn, helloEnvelope, CancellationToken.None);

            // 2. If authenticated on connect, send initial state payloads
            if (session.IsAuthenticated)
            {
                await SendInitialStatesAsync(activeConn);
            }

            // 3. Read loop
            var buffer = new byte[1024 * 16]; // 16 KB buffer
            while (webSocket.State == WebSocketState.Open)
            {
                var receiveResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                if (receiveResult.MessageType == WebSocketMessageType.Close)
                {
                    _logger.LogInformation("Client requested close. ID: {ConnectionId}", connectionId);
                    await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                    break;
                }

                if (receiveResult.MessageType == WebSocketMessageType.Text)
                {
                    if (receiveResult.EndOfMessage)
                    {
                        // Fast zero-allocation path for standard messages (mouse moves, clicks, keyboard)
                        await ProcessMessageAsync(activeConn, session, buffer.AsMemory(0, receiveResult.Count));
                    }
                    else
                    {
                        // Multi-fragment large message fallback
                        using var ms = new MemoryStream();
                        ms.Write(buffer, 0, receiveResult.Count);
                        WebSocketReceiveResult contResult;
                        do
                        {
                            contResult = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                            if (contResult.MessageType == WebSocketMessageType.Close) break;
                            ms.Write(buffer, 0, contResult.Count);
                            if (ms.Length > 1024 * 1024)
                            {
                                _logger.LogWarning("Incoming message exceeded 1MB limit from {ConnectionId}, closing", connectionId);
                                break;
                            }
                        }
                        while (!contResult.EndOfMessage);

                        if (contResult.MessageType == WebSocketMessageType.Close || ms.Length > 1024 * 1024)
                        {
                            _logger.LogInformation("Client requested close or exceeded limit. ID: {ConnectionId}", connectionId);
                            await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Closing", CancellationToken.None);
                            break;
                        }

                        await ProcessMessageAsync(activeConn, session, ms.ToArray());
                    }
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
            _connections.TryRemove(connectionId, out _);
            _sessions.TryRemove(connectionId, out _);
            _screenCoordinator.StopStream(connectionId);
            _inputSimulator.ReleaseConnectionKeys(connectionId);
            if (_connections.IsEmpty)
            {
                _inputSimulator.ReleaseAllKeys();
            }
            _logger.LogInformation("WebSocket client removed. ID: {ConnectionId}. Remaining: {Count}", connectionId, _connections.Count);
            ActiveConnectionsChanged?.Invoke(_connections.Count);

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
            activeConn.Dispose();
            webSocket.Dispose();
        }
    }

    private async Task SendInitialStatesAsync(ActiveConnection conn)
    {
        try
        {
            var initialVol = _audioManager.GetVolumeState();
            await SendJsonAsync(conn, MessageEnvelope<VolumeStatePayload>.Create("event", ActionTypes.VolumeState, initialVol), CancellationToken.None);

            var initialMedia = await _mediaManager.GetNowPlayingAsync();
            await SendJsonAsync(conn, MessageEnvelope<MediaNowPlayingPayload>.Create("event", ActionTypes.MediaNowPlaying, initialMedia), CancellationToken.None);

            var initialPower = _systemControlManager.GetCurrentPowerStatus();
            await SendJsonAsync(conn, MessageEnvelope<PowerStatusPayload>.Create("event", ActionTypes.PowerStatus, initialPower), CancellationToken.None);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to send initial states to connection {ConnectionId}", conn.ConnectionId);
        }
    }

    private async Task ProcessMessageAsync(ActiveConnection conn, ClientSessionInfo session, ReadOnlyMemory<byte> rawJsonBytes)
    {
        var connectionId = conn.ConnectionId;
        try
        {
            using var doc = JsonDocument.Parse(rawJsonBytes);
            var root = doc.RootElement;

            // 1. Protocol Version Validation
            if (root.TryGetProperty("version", out var versionProp) && versionProp.ValueKind == JsonValueKind.Number)
            {
                int ver = versionProp.GetInt32();
                if (ver != 1)
                {
                    await SendErrorAsync(conn, "BAD_REQUEST", $"Unsupported protocol version: {ver}. Expected version 1.");
                    return;
                }
            }

            // 2. Action Property Validation
            if (!root.TryGetProperty("action", out var actionProp) || actionProp.ValueKind != JsonValueKind.String)
            {
                _logger.LogWarning("Received message without valid 'action' property from {ConnectionId}", connectionId);
                await SendErrorAsync(conn, "BAD_REQUEST", "Message must specify string 'action'");
                return;
            }

            var action = actionProp.GetString();
            if (string.IsNullOrEmpty(action))
            {
                await SendErrorAsync(conn, "BAD_REQUEST", "Action cannot be empty");
                return;
            }

            // 3. Rate Limiting Check
            if (!session.RateLimiter.CheckAllowed(action, out var limitReason))
            {
                _logger.LogWarning("Rate limit triggered for {Action} from {ConnectionId}: {Reason}", action, connectionId, limitReason);
                await SendErrorAsync(conn, "RATE_LIMITED", limitReason ?? "Rate limit exceeded", action);
                return;
            }

            // 4. Authentication Check for Privileged Actions
            bool isPublicAction = action.Equals(ActionTypes.SystemPing, StringComparison.OrdinalIgnoreCase) ||
                                  action.Equals(ActionTypes.AuthPair, StringComparison.OrdinalIgnoreCase) ||
                                  action.Equals(ActionTypes.AuthLogin, StringComparison.OrdinalIgnoreCase) ||
                                  action.Equals(ActionTypes.AuthStatus, StringComparison.OrdinalIgnoreCase);

            if (!isPublicAction)
            {
                if (!session.IsAuthenticated)
                {
                    _logger.LogWarning("Unauthenticated command '{Action}' rejected from {ConnectionId}", action, connectionId);
                    await SendErrorAsync(conn, "UNAUTHORIZED", "Authentication required for this operation", action);
                    return;
                }

                // 5. Capability-Based Authorization Check
                var requiredCap = SecurityCapabilities.MapActionToCapability(action);
                if (requiredCap != null && !session.Capabilities.Contains(requiredCap))
                {
                    _logger.LogWarning("Unauthorized command '{Action}' (requires {Cap}) rejected for {ConnectionId}", action, requiredCap, connectionId);
                    await SendErrorAsync(conn, "FORBIDDEN", $"Missing required capability: {requiredCap}", action);
                    return;
                }
            }

            // 6. Action Processing & Payload Validation
            switch (action)
            {
                case ActionTypes.SystemPing:
                    long clientTime = 0;
                    if (root.TryGetProperty("payload", out var pingPayload) &&
                        pingPayload.TryGetProperty("clientTime", out var clientTimeProp) &&
                        clientTimeProp.ValueKind == JsonValueKind.Number)
                    {
                        clientTime = clientTimeProp.GetInt64();
                    }

                    var pong = new PongPayload
                    {
                        ClientTime = clientTime,
                        ServerTime = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                    };
                    await SendJsonAsync(conn, MessageEnvelope<PongPayload>.Create("heartbeat", ActionTypes.SystemPong, pong), CancellationToken.None);
                    break;

                // --- AUTHENTICATION & PAIRING ---
                case ActionTypes.AuthPair:
                    if (root.TryGetProperty("payload", out var pairPayload) &&
                        pairPayload.TryGetProperty("pin", out var pinProp))
                    {
                        string pin = pinProp.GetString() ?? string.Empty;
                        string devName = pairPayload.TryGetProperty("deviceName", out var devProp) ? devProp.GetString() ?? "iPhone Safari" : "iPhone Safari";

                        bool paired = _pairingManager.VerifyPairingCode(
                            pin,
                            session.ClientIp,
                            devName,
                            out string? generatedToken,
                            out string? pairError,
                            out DevicePairing? pairing);

                        if (paired && pairing != null)
                        {
                            session.IsAuthenticated = true;
                            session.DeviceId = pairing.DeviceId;
                            session.DeviceName = pairing.DeviceName;
                            session.Capabilities.Clear();
                            foreach (var c in pairing.Capabilities) session.Capabilities.Add(c);

                            var res = new AuthResultPayload
                            {
                                Authenticated = true,
                                Token = generatedToken,
                                DeviceId = pairing.DeviceId,
                                DeviceName = pairing.DeviceName,
                                Capabilities = pairing.Capabilities,
                                Message = "Pairing successful"
                            };
                            await SendJsonAsync(conn, MessageEnvelope<AuthResultPayload>.Create("response", ActionTypes.AuthResult, res), CancellationToken.None);
                            await SendInitialStatesAsync(conn);
                        }
                        else
                        {
                            var res = new AuthResultPayload
                            {
                                Authenticated = false,
                                Message = pairError ?? "Invalid pairing code"
                            };
                            await SendJsonAsync(conn, MessageEnvelope<AuthResultPayload>.Create("response", ActionTypes.AuthResult, res), CancellationToken.None);
                        }
                    }
                    else
                    {
                        await SendErrorAsync(conn, "BAD_REQUEST", "Missing 'pin' in auth.pair payload", action);
                    }
                    break;

                case ActionTypes.AuthLogin:
                    if (root.TryGetProperty("payload", out var loginPayload) &&
                        loginPayload.TryGetProperty("token", out var tokenProp))
                    {
                        var clientToken = tokenProp.GetString();
                        bool valid = false;
                        string? deviceId = null;
                        string? deviceName = null;
                        List<string> caps = new();

                        if (_pairingManager.ValidateToken(clientToken, out var pairedDevice))
                        {
                            valid = true;
                            deviceId = pairedDevice!.DeviceId;
                            deviceName = pairedDevice.DeviceName;
                            caps = pairedDevice.Capabilities;
                        }
                        else if (!string.IsNullOrEmpty(_options.AuthToken) && clientToken == _options.AuthToken)
                        {
                            valid = true;
                            deviceId = "legacy";
                            deviceName = "Configured Token";
                            caps = SecurityCapabilities.All.ToList();
                        }

                        if (valid)
                        {
                            session.IsAuthenticated = true;
                            session.DeviceId = deviceId;
                            session.DeviceName = deviceName;
                            session.Capabilities.Clear();
                            foreach (var c in caps) session.Capabilities.Add(c);

                            var res = new AuthResultPayload
                            {
                                Authenticated = true,
                                DeviceId = deviceId,
                                DeviceName = deviceName,
                                Capabilities = caps,
                                Message = "Session authenticated"
                            };
                            await SendJsonAsync(conn, MessageEnvelope<AuthResultPayload>.Create("response", ActionTypes.AuthResult, res), CancellationToken.None);
                            await SendInitialStatesAsync(conn);
                        }
                        else
                        {
                            var res = new AuthResultPayload
                            {
                                Authenticated = false,
                                Message = "Invalid authentication token"
                            };
                            await SendJsonAsync(conn, MessageEnvelope<AuthResultPayload>.Create("response", ActionTypes.AuthResult, res), CancellationToken.None);
                        }
                    }
                    else
                    {
                        await SendErrorAsync(conn, "BAD_REQUEST", "Missing 'token' in auth.login payload", action);
                    }
                    break;

                case ActionTypes.AuthStatus:
                    var statusPayload = new AuthStatusPayload
                    {
                        Authenticated = session.IsAuthenticated,
                        DeviceId = session.DeviceId,
                        DeviceName = session.DeviceName,
                        Capabilities = session.Capabilities.ToList()
                    };
                    await SendJsonAsync(conn, MessageEnvelope<AuthStatusPayload>.Create("response", ActionTypes.AuthStatus, statusPayload), CancellationToken.None);
                    break;

                // --- MOUSE & TOUCHPAD ---
                case ActionTypes.MouseMove:
                    if (root.TryGetProperty("payload", out var movePayload))
                    {
                        int dx = movePayload.TryGetProperty("dx", out var dxProp) && dxProp.ValueKind == JsonValueKind.Number ? dxProp.GetInt32() : 0;
                        int dy = movePayload.TryGetProperty("dy", out var dyProp) && dyProp.ValueKind == JsonValueKind.Number ? dyProp.GetInt32() : 0;
                        dx = Math.Clamp(dx, -2000, 2000);
                        dy = Math.Clamp(dy, -2000, 2000);
                        _inputSimulator.MoveMouseRelative(dx, dy);
                    }
                    break;

                case ActionTypes.MouseClick:
                    if (root.TryGetProperty("payload", out var clickPayload))
                    {
                        var btn = clickPayload.TryGetProperty("button", out var btnProp) ? btnProp.GetString() ?? "left" : "left";
                        if (!IsValidMouseButton(btn)) { await SendErrorAsync(conn, "INVALID_PARAM", "Invalid mouse button", action); return; }
                        bool isDouble = clickPayload.TryGetProperty("double", out var doubleProp) && doubleProp.GetBoolean();
                        _inputSimulator.MouseClick(btn, isDouble);
                    }
                    break;

                case ActionTypes.MouseDown:
                    if (root.TryGetProperty("payload", out var downPayload))
                    {
                        var btn = downPayload.TryGetProperty("button", out var btnProp) ? btnProp.GetString() ?? "left" : "left";
                        if (!IsValidMouseButton(btn)) { await SendErrorAsync(conn, "INVALID_PARAM", "Invalid mouse button", action); return; }
                        _inputSimulator.MouseDown(btn, connectionId);
                    }
                    break;

                case ActionTypes.MouseUp:
                    if (root.TryGetProperty("payload", out var upPayload))
                    {
                        var btn = upPayload.TryGetProperty("button", out var btnProp) ? btnProp.GetString() ?? "left" : "left";
                        if (!IsValidMouseButton(btn)) { await SendErrorAsync(conn, "INVALID_PARAM", "Invalid mouse button", action); return; }
                        _inputSimulator.MouseUp(btn, connectionId);
                    }
                    break;

                case ActionTypes.MouseScroll:
                    if (root.TryGetProperty("payload", out var scrollPayload))
                    {
                        int dx = scrollPayload.TryGetProperty("dx", out var dxProp) && dxProp.ValueKind == JsonValueKind.Number ? dxProp.GetInt32() : 0;
                        int dy = scrollPayload.TryGetProperty("dy", out var dyProp) && dyProp.ValueKind == JsonValueKind.Number ? dyProp.GetInt32() : 0;
                        dx = Math.Clamp(dx, -2000, 2000);
                        dy = Math.Clamp(dy, -2000, 2000);
                        _inputSimulator.MouseScroll(dx, dy);
                    }
                    break;

                // --- KEYBOARD & TEXT ---
                case ActionTypes.KeyboardText:
                    if (root.TryGetProperty("payload", out var textPayload) &&
                        textPayload.TryGetProperty("text", out var textProp))
                    {
                        var text = textProp.GetString();
                        if (text != null)
                        {
                            if (text.Length > 2000)
                            {
                                await SendErrorAsync(conn, "PAYLOAD_TOO_LARGE", "Text payload exceeds 2000 characters limit", action);
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
                                await SendErrorAsync(conn, "INVALID_KEY", $"Key '{key}' is not mapped or recognized", action);
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
                            await SendErrorAsync(conn, "INVALID_SHORTCUT", "Shortcut exceeds 8 keys limit", action);
                            return;
                        }

                        if (keys.Any(k => !_inputSimulator.IsValidKey(k)))
                        {
                            await SendErrorAsync(conn, "INVALID_KEY", "Shortcut contains unmapped key", action);
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

                // --- VOLUME & AUDIO ---
                case ActionTypes.VolumeRequestState:
                    var currentVolState = _audioManager.GetVolumeState();
                    await SendJsonAsync(conn, MessageEnvelope<VolumeStatePayload>.Create("event", ActionTypes.VolumeState, currentVolState), CancellationToken.None);
                    break;

                case ActionTypes.VolumeSetMaster:
                    if (root.TryGetProperty("payload", out var setMasterPayload))
                    {
                        if (setMasterPayload.TryGetProperty("volume", out var volProp) && volProp.ValueKind == JsonValueKind.Number)
                        {
                            float vol = Math.Clamp((float)volProp.GetDouble(), 0f, 100f);
                            _audioManager.SetMasterVolume(vol);
                        }
                        if (setMasterPayload.TryGetProperty("mute", out var muteProp) &&
                            (muteProp.ValueKind == JsonValueKind.True || muteProp.ValueKind == JsonValueKind.False))
                        {
                            _audioManager.SetMasterMute(muteProp.GetBoolean());
                        }
                    }
                    break;

                case ActionTypes.VolumeSetSession:
                    if (root.TryGetProperty("payload", out var setSessionPayload))
                    {
                        var sessionId = setSessionPayload.TryGetProperty("sessionId", out var idProp) ? idProp.GetString() ?? "" : "";
                        if (sessionId.Length > 256) sessionId = sessionId[..256];

                        if (setSessionPayload.TryGetProperty("volume", out var volProp) && volProp.ValueKind == JsonValueKind.Number)
                        {
                            float vol = Math.Clamp((float)volProp.GetDouble(), 0f, 100f);
                            _audioManager.SetSessionVolume(sessionId, vol);
                        }
                        if (setSessionPayload.TryGetProperty("mute", out var muteProp) &&
                            (muteProp.ValueKind == JsonValueKind.True || muteProp.ValueKind == JsonValueKind.False))
                        {
                            _audioManager.SetSessionMute(sessionId, muteProp.GetBoolean());
                        }
                    }
                    break;

                // --- MEDIA CONTROL ---
                case ActionTypes.MediaRequestNowPlaying:
                    var nowPlaying = await _mediaManager.GetNowPlayingAsync();
                    await SendJsonAsync(conn, MessageEnvelope<MediaNowPlayingPayload>.Create("event", ActionTypes.MediaNowPlaying, nowPlaying), CancellationToken.None);
                    break;

                case ActionTypes.MediaAction:
                    if (root.TryGetProperty("payload", out var mediaPayload) &&
                        mediaPayload.TryGetProperty("action", out var mediaActionProp))
                    {
                        var act = mediaActionProp.GetString();
                        if (IsValidMediaAction(act))
                        {
                            await _mediaManager.ExecuteMediaActionAsync(act!);
                        }
                        else
                        {
                            await SendErrorAsync(conn, "INVALID_PARAM", $"Invalid media action: {act}", action);
                        }
                    }
                    break;

                // --- POWER & SYSTEM CONTROLS ---
                case ActionTypes.PowerRequestStatus:
                    var powerStatus = _systemControlManager.GetCurrentPowerStatus();
                    await SendJsonAsync(conn, MessageEnvelope<PowerStatusPayload>.Create("event", ActionTypes.PowerStatus, powerStatus), CancellationToken.None);
                    break;

                case ActionTypes.PowerAction:
                    if (root.TryGetProperty("payload", out var powerPayload) &&
                        powerPayload.TryGetProperty("action", out var pActionProp))
                    {
                        var act = pActionProp.GetString()?.ToLowerInvariant();
                        switch (act)
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
                                await SendErrorAsync(conn, "INVALID_PARAM", $"Unknown power action: {act}", action);
                                break;
                        }
                    }
                    break;

                case ActionTypes.PowerSchedule:
                    if (root.TryGetProperty("payload", out var schedulePayload))
                    {
                        var schedAction = schedulePayload.TryGetProperty("action", out var schedActProp) ? schedActProp.GetString() ?? "shutdown" : "shutdown";
                        int timeoutSeconds = schedulePayload.TryGetProperty("timeoutSeconds", out var secProp) && secProp.ValueKind == JsonValueKind.Number 
                            ? secProp.GetInt32() 
                            : 1800;
                        timeoutSeconds = Math.Clamp(timeoutSeconds, 10, 86400);

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
                    _systemControlManager.CancelScheduledShutdown();
                    break;

                case ActionTypes.SystemLaunchApp:
                    if (root.TryGetProperty("payload", out var launchPayload) &&
                        launchPayload.TryGetProperty("app", out var appProp))
                    {
                        var appName = appProp.GetString();
                        if (!string.IsNullOrEmpty(appName) && IsValidAppName(appName))
                        {
                            _systemControlManager.LaunchApp(appName);
                        }
                        else
                        {
                            await SendErrorAsync(conn, "INVALID_PARAM", "Invalid app identifier", action);
                        }
                    }
                    break;

                // --- SCREEN STREAMING & MIRRORING ---
                case ActionTypes.ScreenStart:
                    var cfg = new ScreenStartPayload();
                    if (root.TryGetProperty("payload", out var sStartPayload))
                    {
                        if (sStartPayload.TryGetProperty("fps", out var fpsP) && fpsP.ValueKind == JsonValueKind.Number) 
                            cfg.Fps = Math.Clamp(fpsP.GetInt32(), 1, 30);
                        if (sStartPayload.TryGetProperty("quality", out var qP) && qP.ValueKind == JsonValueKind.Number) 
                            cfg.Quality = Math.Clamp(qP.GetInt32(), 10, 100);
                        if (sStartPayload.TryGetProperty("scale", out var scP) && scP.ValueKind == JsonValueKind.Number) 
                            cfg.Scale = Math.Clamp((float)scP.GetDouble(), 0.25f, 1.0f);
                        if (sStartPayload.TryGetProperty("monitorIndex", out var monP) && monP.ValueKind == JsonValueKind.Number) 
                            cfg.MonitorIndex = Math.Max(0, monP.GetInt32());
                    }
                    _screenCoordinator.StartStream(connectionId, (packet, ct) => conn.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, ct), cfg);
                    break;

                case ActionTypes.ScreenStop:
                    _screenCoordinator.StopStream(connectionId);
                    break;

                case ActionTypes.ScreenSnapshot:
                    int monIdx = 0;
                    float snapScale = 1.0f;
                    int snapQuality = 85;
                    if (root.TryGetProperty("payload", out var snapPayload))
                    {
                        if (snapPayload.TryGetProperty("monitorIndex", out var mP) && mP.ValueKind == JsonValueKind.Number) 
                            monIdx = Math.Max(0, mP.GetInt32());
                        if (snapPayload.TryGetProperty("scale", out var sP) && sP.ValueKind == JsonValueKind.Number) 
                            snapScale = Math.Clamp((float)sP.GetDouble(), 0.25f, 1.0f);
                        if (snapPayload.TryGetProperty("quality", out var qP) && qP.ValueKind == JsonValueKind.Number) 
                            snapQuality = Math.Clamp(qP.GetInt32(), 10, 100);
                    }
                    var snapFrame = _screenCoordinator.CaptureSnapshot(monIdx, snapScale, snapQuality);
                    if (snapFrame != null)
                    {
                        var packet = Platform.Screen.BinaryFrameHeader.Pack(snapFrame);
                        await conn.SendAsync(new ArraySegment<byte>(packet), WebSocketMessageType.Binary, true, CancellationToken.None);
                    }
                    break;

                case ActionTypes.ScreenTouch:
                    if (root.TryGetProperty("payload", out var touchPayload))
                    {
                        float normX = touchPayload.TryGetProperty("normX", out var nxP) && nxP.ValueKind == JsonValueKind.Number ? (float)nxP.GetDouble() : 0.5f;
                        float normY = touchPayload.TryGetProperty("normY", out var nyP) && nyP.ValueKind == JsonValueKind.Number ? (float)nyP.GetDouble() : 0.5f;
                        normX = Math.Clamp(normX, 0f, 1f);
                        normY = Math.Clamp(normY, 0f, 1f);

                        string tType = touchPayload.TryGetProperty("type", out var ttP) ? ttP.GetString() ?? "click" : "click";
                        string tBtn = touchPayload.TryGetProperty("button", out var tbP) ? tbP.GetString() ?? "left" : "left";
                        if (!IsValidMouseButton(tBtn)) tBtn = "left";

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
                                    _inputSimulator.MouseDown(tBtn, connectionId);
                                    break;
                                case "up":
                                    _inputSimulator.MouseUp(tBtn, connectionId);
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
                    await SendJsonAsync(conn, MessageEnvelope<List<Platform.Screen.ScreenMonitorInfo>>.Create("response", ActionTypes.ScreenMonitors, monitors), CancellationToken.None);
                    break;

                default:
                    _logger.LogInformation("Unhandled or unknown protocol action received: {Action}", action);
                    await SendErrorAsync(conn, "UNKNOWN_ACTION", $"Unknown action '{action}'", action);
                    break;
            }
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse incoming WebSocket JSON message from {ConnectionId}", connectionId);
            await SendErrorAsync(conn, "BAD_REQUEST", "Malformed JSON message");
        }
    }

    private static bool IsValidMouseButton(string? button) =>
        button != null && (button.Equals("left", StringComparison.OrdinalIgnoreCase) ||
                           button.Equals("right", StringComparison.OrdinalIgnoreCase) ||
                           button.Equals("middle", StringComparison.OrdinalIgnoreCase));

    private static bool IsValidMediaAction(string? action) =>
        action != null && (action.Equals("play", StringComparison.OrdinalIgnoreCase) ||
                           action.Equals("pause", StringComparison.OrdinalIgnoreCase) ||
                           action.Equals("playpause", StringComparison.OrdinalIgnoreCase) ||
                           action.Equals("next", StringComparison.OrdinalIgnoreCase) ||
                           action.Equals("previous", StringComparison.OrdinalIgnoreCase) ||
                           action.Equals("stop", StringComparison.OrdinalIgnoreCase));

    private static bool IsValidAppName(string app)
    {
        if (app.Length > 60) return false;
        // Whitelist alphanumeric, dots, hyphens, and underscores only (prevent cmd injection)
        return app.All(c => char.IsLetterOrDigit(c) || c is '.' or '-' or '_' or ' ');
    }

    private Task SendErrorAsync(ActiveConnection conn, string code, string message, string? originalAction = null)
    {
        var err = new ErrorPayload
        {
            Code = code,
            Message = message,
            OriginalAction = originalAction
        };
        var env = MessageEnvelope<ErrorPayload>.Create("response", ActionTypes.SystemError, err);
        return SendJsonAsync(conn, env, CancellationToken.None);
    }

    public async Task<bool> SendJsonAsync<T>(ActiveConnection conn, MessageEnvelope<T> envelope, CancellationToken cancellationToken = default)
    {
        if (conn.Socket.State != WebSocketState.Open)
        {
            return false;
        }

        var json = JsonSerializer.Serialize(envelope, _jsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        return await conn.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, cancellationToken);
    }

    public async Task BroadcastToAuthenticatedAsync<T>(MessageEnvelope<T> envelope, string requiredCapability, CancellationToken cancellationToken = default)
    {
        var tasks = _sessions
            .Where(kv => kv.Value.IsAuthenticated && kv.Value.Capabilities.Contains(requiredCapability))
            .Select(kv => _connections.TryGetValue(kv.Key, out var conn) ? conn : null)
            .Where(c => c != null && c.Socket.State == WebSocketState.Open)
            .Select(c => SendJsonAsync(c!, envelope, cancellationToken));

        await Task.WhenAll(tasks);
    }

    public async Task BroadcastAsync<T>(MessageEnvelope<T> envelope, CancellationToken cancellationToken = default)
    {
        var tasks = _connections.Values
            .Where(c => c.Socket.State == WebSocketState.Open)
            .Select(c => SendJsonAsync(c, envelope, cancellationToken));
        await Task.WhenAll(tasks);
    }
}

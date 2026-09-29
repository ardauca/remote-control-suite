using Microsoft.Extensions.Logging;
using RemoteAgent.Network.Protocol;
using Windows.Media.Control;

namespace RemoteAgent.Platform.Media;

public class WindowsMediaManager : IMediaManager
{
    private readonly ILogger<WindowsMediaManager> _logger;
    private GlobalSystemMediaTransportControlsSessionManager? _sessionManager;
    private GlobalSystemMediaTransportControlsSession? _currentSession;
    private readonly object _lock = new();

    public event Action<MediaNowPlayingPayload>? NowPlayingChanged;

    private const byte VK_MEDIA_NEXT_TRACK = 0xB0;
    private const byte VK_MEDIA_PREV_TRACK = 0xB1;
    private const byte VK_MEDIA_STOP = 0xB2;
    private const byte VK_MEDIA_PLAY_PAUSE = 0xB3;

    public WindowsMediaManager(ILogger<WindowsMediaManager> logger)
    {
        _logger = logger;
        Task.Run(InitializeSessionManagerAsync);
    }

    private async Task InitializeSessionManagerAsync()
    {
        try
        {
            _sessionManager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            if (_sessionManager != null)
            {
                _sessionManager.CurrentSessionChanged += OnCurrentSessionChanged;
                UpdateCurrentSession(_sessionManager.GetCurrentSession());
                _logger.LogInformation("GlobalSystemMediaTransportControlsSessionManager initialized.");
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to initialize WinRT Media Session Manager (will use Win32 media keys fallback)");
        }
    }

    private void OnCurrentSessionChanged(GlobalSystemMediaTransportControlsSessionManager sender, CurrentSessionChangedEventArgs args)
    {
        try
        {
            UpdateCurrentSession(sender.GetCurrentSession());
            _ = BroadcastNowPlayingAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling current media session change");
        }
    }

    private void UpdateCurrentSession(GlobalSystemMediaTransportControlsSession? newSession)
    {
        lock (_lock)
        {
            if (_currentSession != null)
            {
                try
                {
                    _currentSession.MediaPropertiesChanged -= OnMediaPropertiesChanged;
                    _currentSession.PlaybackInfoChanged -= OnPlaybackInfoChanged;
                }
                catch
                {
                    // Ignore
                }
            }

            _currentSession = newSession;

            if (_currentSession != null)
            {
                _currentSession.MediaPropertiesChanged += OnMediaPropertiesChanged;
                _currentSession.PlaybackInfoChanged += OnPlaybackInfoChanged;
            }
        }
    }

    private void OnMediaPropertiesChanged(GlobalSystemMediaTransportControlsSession sender, MediaPropertiesChangedEventArgs args)
    {
        _ = BroadcastNowPlayingAsync();
    }

    private void OnPlaybackInfoChanged(GlobalSystemMediaTransportControlsSession sender, PlaybackInfoChangedEventArgs args)
    {
        _ = BroadcastNowPlayingAsync();
    }

    private async Task BroadcastNowPlayingAsync()
    {
        try
        {
            var payload = await GetNowPlayingAsync();
            NowPlayingChanged?.Invoke(payload);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error broadcasting NowPlaying update");
        }
    }

    public async Task<MediaNowPlayingPayload> GetNowPlayingAsync()
    {
        var payload = new MediaNowPlayingPayload();

        try
        {
            GlobalSystemMediaTransportControlsSession? session;
            lock (_lock)
            {
                session = _currentSession ?? _sessionManager?.GetCurrentSession();
            }

            if (session != null)
            {
                payload.SourceApp = session.SourceAppUserModelId;
                var playbackInfo = session.GetPlaybackInfo();
                if (playbackInfo != null)
                {
                    payload.IsPlaying = playbackInfo.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                }

                var mediaProperties = await session.TryGetMediaPropertiesAsync();
                if (mediaProperties != null)
                {
                    payload.Title = mediaProperties.Title ?? string.Empty;
                    payload.Artist = mediaProperties.Artist ?? string.Empty;
                    payload.Album = mediaProperties.AlbumTitle ?? string.Empty;
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read WinRT now playing metadata");
        }

        return payload;
    }

    public async Task ExecuteMediaActionAsync(string action)
    {
        var normalized = action.ToLowerInvariant().Trim();
        bool handledViaWinRT = false;

        GlobalSystemMediaTransportControlsSession? session;
        lock (_lock)
        {
            session = _currentSession ?? _sessionManager?.GetCurrentSession();
        }

        if (session != null)
        {
            try
            {
                switch (normalized)
                {
                    case "play":
                        handledViaWinRT = await session.TryPlayAsync();
                        break;
                    case "pause":
                        handledViaWinRT = await session.TryPauseAsync();
                        break;
                    case "playpause":
                    case "toggle":
                        handledViaWinRT = await session.TryTogglePlayPauseAsync();
                        break;
                    case "next":
                        handledViaWinRT = await session.TrySkipNextAsync();
                        break;
                    case "previous":
                    case "prev":
                        handledViaWinRT = await session.TrySkipPreviousAsync();
                        break;
                    case "stop":
                        handledViaWinRT = await session.TryStopAsync();
                        break;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "WinRT media action failed for {Action}, using Win32 fallback", action);
            }
        }

        // Fallback to Win32 multimedia virtual keys if WinRT session was unavailable or unsuccessful
        if (!handledViaWinRT)
        {
            _logger.LogInformation("Executing Win32 media key fallback for: {Action}", normalized);
            byte vk = normalized switch
            {
                "next" => VK_MEDIA_NEXT_TRACK,
                "previous" or "prev" => VK_MEDIA_PREV_TRACK,
                "stop" => VK_MEDIA_STOP,
                _ => VK_MEDIA_PLAY_PAUSE
            };

            Input.NativeMethods.keybd_event(vk, 0, 0, UIntPtr.Zero);
            Input.NativeMethods.keybd_event(vk, 0, Input.NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        // Trigger state refresh after a short delay
        _ = Task.Delay(250).ContinueWith(_ => BroadcastNowPlayingAsync());
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_sessionManager != null)
            {
                _sessionManager.CurrentSessionChanged -= OnCurrentSessionChanged;
            }

            if (_currentSession != null)
            {
                try
                {
                    _currentSession.MediaPropertiesChanged -= OnMediaPropertiesChanged;
                    _currentSession.PlaybackInfoChanged -= OnPlaybackInfoChanged;
                }
                catch
                {
                    // Ignore
                }
                _currentSession = null;
            }
        }
    }
}

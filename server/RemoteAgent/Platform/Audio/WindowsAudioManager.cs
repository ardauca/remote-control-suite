using System.Diagnostics;
using Microsoft.Extensions.Logging;
using NAudio.CoreAudioApi;
using RemoteAgent.Network.Protocol;

namespace RemoteAgent.Platform.Audio;

public class WindowsAudioManager : IAudioManager
{
    private readonly ILogger<WindowsAudioManager> _logger;
    private readonly MMDeviceEnumerator _deviceEnumerator;
    private MMDevice? _defaultPlaybackDevice;
    private AudioEndpointVolumeNotificationDelegate? _volumeNotificationDelegate;
    private readonly object _lock = new();

    public event Action<VolumeStatePayload>? VolumeChanged;

    public WindowsAudioManager(ILogger<WindowsAudioManager> logger)
    {
        _logger = logger;
        _deviceEnumerator = new MMDeviceEnumerator();
        InitializeDevice();
    }

    private void InitializeDevice()
    {
        lock (_lock)
        {
            try
            {
                _defaultPlaybackDevice = _deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                if (_defaultPlaybackDevice != null)
                {
                    _volumeNotificationDelegate = new AudioEndpointVolumeNotificationDelegate(OnAudioEndpointVolumeNotification);
                    _defaultPlaybackDevice.AudioEndpointVolume.OnVolumeNotification += _volumeNotificationDelegate;
                    _logger.LogInformation("WindowsAudioManager initialized with device: {DeviceName}", _defaultPlaybackDevice.FriendlyName);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to initialize default audio playback device");
            }
        }
    }

    private void OnAudioEndpointVolumeNotification(AudioVolumeNotificationData data)
    {
        try
        {
            var state = GetVolumeState();
            VolumeChanged?.Invoke(state);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error handling audio volume notification");
        }
    }

    public VolumeStatePayload GetVolumeState()
    {
        lock (_lock)
        {
            var result = new VolumeStatePayload();

            try
            {
                if (_defaultPlaybackDevice == null)
                {
                    _defaultPlaybackDevice = _deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
                }

                if (_defaultPlaybackDevice == null)
                {
                    return result;
                }

                // Master volume
                result.MasterVolume = MathF.Round(_defaultPlaybackDevice.AudioEndpointVolume.MasterVolumeLevelScalar * 100f, 1);
                result.IsMuted = _defaultPlaybackDevice.AudioEndpointVolume.Mute;

                // Application sessions
                var sessionManager = _defaultPlaybackDevice.AudioSessionManager;
                if (sessionManager != null)
                {
                    var sessions = sessionManager.Sessions;
                    for (int i = 0; i < sessions.Count; i++)
                    {
                        var session = sessions[i];
                        try
                        {
                            var pid = (int)session.GetProcessID;
                            if (pid == 0) continue; // System sounds or idle

                            string appName = string.Empty;
                            try
                            {
                                using var process = Process.GetProcessById(pid);
                                appName = process.ProcessName;
                            }
                            catch
                            {
                                appName = session.DisplayName;
                            }

                            if (string.IsNullOrWhiteSpace(appName))
                            {
                                appName = $"App ({pid})";
                            }

                            var item = new AudioSessionItem
                            {
                                Id = session.GetSessionIdentifier ?? pid.ToString(),
                                Name = appName,
                                ProcessId = pid,
                                Volume = MathF.Round(session.SimpleAudioVolume.Volume * 100f, 1),
                                IsMuted = session.SimpleAudioVolume.Mute
                            };

                            result.Sessions.Add(item);
                        }
                        catch
                        {
                            // Skip dead/inaccessible session
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to retrieve audio volume state");
            }

            return result;
        }
    }

    public void SetMasterVolume(float volume)
    {
        lock (_lock)
        {
            try
            {
                if (_defaultPlaybackDevice == null) return;
                var clamped = Math.Clamp(volume / 100f, 0.0f, 1.0f);
                _defaultPlaybackDevice.AudioEndpointVolume.MasterVolumeLevelScalar = clamped;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set master volume to {Volume}", volume);
            }
        }
    }

    public void SetMasterMute(bool isMuted)
    {
        lock (_lock)
        {
            try
            {
                if (_defaultPlaybackDevice == null) return;
                _defaultPlaybackDevice.AudioEndpointVolume.Mute = isMuted;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set master mute to {Mute}", isMuted);
            }
        }
    }

    public void SetSessionVolume(string sessionId, float volume)
    {
        lock (_lock)
        {
            try
            {
                if (_defaultPlaybackDevice?.AudioSessionManager == null) return;
                var clamped = Math.Clamp(volume / 100f, 0.0f, 1.0f);

                var sessions = _defaultPlaybackDevice.AudioSessionManager.Sessions;
                for (int i = 0; i < sessions.Count; i++)
                {
                    var s = sessions[i];
                    var id = s.GetSessionIdentifier ?? s.GetProcessID.ToString();
                    if (id == sessionId || s.GetProcessID.ToString() == sessionId)
                    {
                        s.SimpleAudioVolume.Volume = clamped;
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set session volume for {SessionId}", sessionId);
            }
        }
    }

    public void SetSessionMute(string sessionId, bool isMuted)
    {
        lock (_lock)
        {
            try
            {
                if (_defaultPlaybackDevice?.AudioSessionManager == null) return;

                var sessions = _defaultPlaybackDevice.AudioSessionManager.Sessions;
                for (int i = 0; i < sessions.Count; i++)
                {
                    var s = sessions[i];
                    var id = s.GetSessionIdentifier ?? s.GetProcessID.ToString();
                    if (id == sessionId || s.GetProcessID.ToString() == sessionId)
                    {
                        s.SimpleAudioVolume.Mute = isMuted;
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set session mute for {SessionId}", sessionId);
            }
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_defaultPlaybackDevice != null && _volumeNotificationDelegate != null)
            {
                try
                {
                    _defaultPlaybackDevice.AudioEndpointVolume.OnVolumeNotification -= _volumeNotificationDelegate;
                }
                catch
                {
                    // Ignore
                }
            }
            _deviceEnumerator.Dispose();
        }
    }
}

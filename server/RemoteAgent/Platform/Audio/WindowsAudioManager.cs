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
        lock (_lock)
        {
            GetOrRefreshDefaultDevice();
        }
    }

    private MMDevice? GetOrRefreshDefaultDevice()
    {
        MMDevice? currentDefault = null;
        try
        {
            currentDefault = _deviceEnumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);

            if (_defaultPlaybackDevice != null)
            {
                try
                {
                    if (_defaultPlaybackDevice.State == DeviceState.Active &&
                        string.Equals(_defaultPlaybackDevice.ID, currentDefault.ID, StringComparison.OrdinalIgnoreCase))
                    {
                        currentDefault.Dispose();
                        return _defaultPlaybackDevice;
                    }
                }
                catch
                {
                    // The cached endpoint can become invalid while Windows changes playback devices.
                }
            }

            DetachCurrentDevice();
            _defaultPlaybackDevice = currentDefault;
            currentDefault = null;

            if (_defaultPlaybackDevice != null)
            {
                _volumeNotificationDelegate = new AudioEndpointVolumeNotificationDelegate(OnAudioEndpointVolumeNotification);
                _defaultPlaybackDevice.AudioEndpointVolume.OnVolumeNotification += _volumeNotificationDelegate;
                _logger.LogInformation("WindowsAudioManager initialized with device: {DeviceName}", _defaultPlaybackDevice.FriendlyName);
            }
            return _defaultPlaybackDevice;
        }
        catch (Exception ex)
        {
            try { currentDefault?.Dispose(); } catch { }
            _logger.LogWarning(ex, "Failed to acquire the current default audio playback device");

            // Keep using the cached endpoint if Windows temporarily fails to enumerate the current default.
            try
            {
                if (_defaultPlaybackDevice?.State == DeviceState.Active)
                {
                    return _defaultPlaybackDevice;
                }
            }
            catch { }

            DetachCurrentDevice();
            return null;
        }
    }

    private void DetachCurrentDevice()
    {
        if (_defaultPlaybackDevice != null)
        {
            try
            {
                if (_volumeNotificationDelegate != null)
                {
                    _defaultPlaybackDevice.AudioEndpointVolume.OnVolumeNotification -= _volumeNotificationDelegate;
                }
            }
            catch
            {
                // Ignore cleanup errors on stale device
            }
            try
            {
                _defaultPlaybackDevice.Dispose();
            }
            catch
            {
                // Ignore
            }
            _defaultPlaybackDevice = null;
            _volumeNotificationDelegate = null;
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
                var device = GetOrRefreshDefaultDevice();
                if (device == null)
                {
                    return result;
                }

                // Master volume
                result.MasterVolume = MathF.Round(device.AudioEndpointVolume.MasterVolumeLevelScalar * 100f, 1);
                result.IsMuted = device.AudioEndpointVolume.Mute;

                // Application sessions
                var sessionManager = device.AudioSessionManager;
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

                            var sessId = session.GetSessionIdentifier;
                            var item = new AudioSessionItem
                            {
                                Id = !string.IsNullOrWhiteSpace(sessId) ? sessId : $"pid:{pid}",
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

    public void SetMaster(float? volume, bool? isMuted)
    {
        lock (_lock)
        {
            try
            {
                var device = GetOrRefreshDefaultDevice();
                if (device == null) return;

                bool modified = false;

                if (volume.HasValue)
                {
                    var clamped = Math.Clamp(volume.Value / 100f, 0.0f, 1.0f);
                    try
                    {
                        device.AudioEndpointVolume.MasterVolumeLevelScalar = clamped;
                        modified = true;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to set master volume scalar, refreshing endpoint");
                        DetachCurrentDevice();
                        device = GetOrRefreshDefaultDevice();
                        if (device != null)
                        {
                            device.AudioEndpointVolume.MasterVolumeLevelScalar = clamped;
                            modified = true;
                        }
                    }
                }

                if (isMuted.HasValue && device != null)
                {
                    try
                    {
                        device.AudioEndpointVolume.Mute = isMuted.Value;
                        modified = true;
                    }
                    catch (Exception ex)
                    {
                        _logger.LogWarning(ex, "Failed to set master mute, refreshing endpoint");
                        DetachCurrentDevice();
                        device = GetOrRefreshDefaultDevice();
                        if (device != null)
                        {
                            device.AudioEndpointVolume.Mute = isMuted.Value;
                            modified = true;
                        }
                    }
                }

                if (modified)
                {
                    VolumeChanged?.Invoke(GetVolumeState());
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set master audio state (Vol: {Volume}, Mute: {Mute})", volume, isMuted);
            }
        }
    }

    public void SetMasterVolume(float volume) => SetMaster(volume, null);

    public void SetMasterMute(bool isMuted) => SetMaster(null, isMuted);

    private static bool MatchesSession(NAudio.CoreAudioApi.AudioSessionControl session, string targetId)
    {
        if (string.IsNullOrWhiteSpace(targetId)) return false;

        // 1. Check SessionIdentifier
        try
        {
            var sessId = session.GetSessionIdentifier;
            if (!string.IsNullOrEmpty(sessId) && string.Equals(sessId, targetId, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        catch { }

        // 2. Check SessionInstanceIdentifier
        try
        {
            var instId = session.GetSessionInstanceIdentifier;
            if (!string.IsNullOrEmpty(instId) && string.Equals(instId, targetId, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        catch { }

        // 3. Process ID checks ("1234", "pid:1234")
        try
        {
            var pid = session.GetProcessID.ToString();
            if (string.Equals(pid, targetId, StringComparison.OrdinalIgnoreCase))
                return true;

            if (string.Equals($"pid:{pid}", targetId, StringComparison.OrdinalIgnoreCase))
                return true;

            if (targetId.StartsWith("pid:", StringComparison.OrdinalIgnoreCase) &&
                string.Equals(targetId[4..], pid, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        catch { }

        return false;
    }

    public void SetSession(string sessionId, float? volume, bool? isMuted)
    {
        lock (_lock)
        {
            try
            {
                var device = GetOrRefreshDefaultDevice();
                if (device?.AudioSessionManager == null) return;

                var sessions = device.AudioSessionManager.Sessions;
                bool found = false;
                for (int i = 0; i < sessions.Count; i++)
                {
                    var s = sessions[i];
                    if (MatchesSession(s, sessionId))
                    {
                        if (volume.HasValue)
                        {
                            s.SimpleAudioVolume.Volume = Math.Clamp(volume.Value / 100f, 0.0f, 1.0f);
                        }
                        if (isMuted.HasValue)
                        {
                            s.SimpleAudioVolume.Mute = isMuted.Value;
                        }
                        found = true;
                        break;
                    }
                }

                if (found)
                {
                    VolumeChanged?.Invoke(GetVolumeState());
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to set session audio state for {SessionId}", sessionId);
            }
        }
    }

    public void SetSessionVolume(string sessionId, float volume) => SetSession(sessionId, volume, null);

    public void SetSessionMute(string sessionId, bool isMuted) => SetSession(sessionId, null, isMuted);

    public void Dispose()
    {
        lock (_lock)
        {
            DetachCurrentDevice();
            _deviceEnumerator.Dispose();
        }
    }
}

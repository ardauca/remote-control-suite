using RemoteAgent.Network.Protocol;

namespace RemoteAgent.Platform.Audio;

public interface IAudioManager : IDisposable
{
    VolumeStatePayload GetVolumeState();
    void SetMasterVolume(float volume);
    void SetMasterMute(bool isMuted);
    void SetSessionVolume(string sessionId, float volume);
    void SetSessionMute(string sessionId, bool isMuted);

    event Action<VolumeStatePayload>? VolumeChanged;
}

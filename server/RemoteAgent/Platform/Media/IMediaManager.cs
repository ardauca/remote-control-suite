using RemoteAgent.Network.Protocol;

namespace RemoteAgent.Platform.Media;

public interface IMediaManager : IDisposable
{
    Task<MediaNowPlayingPayload> GetNowPlayingAsync();
    Task ExecuteMediaActionAsync(string action);

    event Action<MediaNowPlayingPayload>? NowPlayingChanged;
}

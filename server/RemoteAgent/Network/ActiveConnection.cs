using System.Net.WebSockets;

namespace RemoteAgent.Network;

public sealed class ActiveConnection : IDisposable
{
    public string ConnectionId { get; }
    public WebSocket Socket { get; }
    public SemaphoreSlim SendLock { get; } = new(1, 1);

    public ActiveConnection(string connectionId, WebSocket socket)
    {
        ConnectionId = connectionId;
        Socket = socket;
    }

    public async Task<bool> SendAsync(ArraySegment<byte> buffer, WebSocketMessageType messageType, bool endOfMessage, CancellationToken ct)
    {
        if (Socket.State != WebSocketState.Open)
        {
            return false;
        }

        bool lockAcquired = false;
        try
        {
            lockAcquired = await SendLock.WaitAsync(TimeSpan.FromSeconds(8), ct);
            if (!lockAcquired)
            {
                return false;
            }

            if (Socket.State != WebSocketState.Open)
            {
                return false;
            }

            await Socket.SendAsync(buffer, messageType, endOfMessage, ct);
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            if (lockAcquired)
            {
                try 
                { 
                    SendLock.Release(); 
                } 
                catch 
                { 
                }
            }
        }
    }

    public void Dispose()
    {
        SendLock.Dispose();
    }
}

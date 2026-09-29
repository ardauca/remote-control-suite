using System.Text.Json.Serialization;

namespace RemoteAgent.Network.Protocol;

public class MessageEnvelope<T>
{
    [JsonPropertyName("version")]
    public int Version { get; set; } = 1;

    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N");

    [JsonPropertyName("type")]
    public string Type { get; set; } = "event"; // "command", "event", "response", "heartbeat"

    [JsonPropertyName("action")]
    public string Action { get; set; } = string.Empty;

    [JsonPropertyName("payload")]
    public T? Payload { get; set; }

    [JsonPropertyName("timestamp")]
    public long Timestamp { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public static MessageEnvelope<T> Create(string type, string action, T? payload)
    {
        return new MessageEnvelope<T>
        {
            Version = 1,
            Id = Guid.NewGuid().ToString("N"),
            Type = type,
            Action = action,
            Payload = payload,
            Timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
        };
    }
}

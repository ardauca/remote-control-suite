using System.Text.Json.Serialization;

namespace RemoteAgent.Security;

public class DevicePairing
{
    [JsonPropertyName("deviceId")]
    public string DeviceId { get; set; } = string.Empty;

    [JsonPropertyName("deviceName")]
    public string DeviceName { get; set; } = string.Empty;

    [JsonPropertyName("tokenHash")]
    public string TokenHash { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("lastUsedAt")]
    public DateTime LastUsedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("capabilities")]
    public List<string> Capabilities { get; set; } = new()
    {
        SecurityCapabilities.InputControl,
        SecurityCapabilities.MediaControl,
        SecurityCapabilities.VolumeControl,
        SecurityCapabilities.PowerControl,
        SecurityCapabilities.ScreenRead
    };
}

using System.Text.Json.Serialization;

namespace RemoteAgent.Network.Protocol;

public class PingPayload
{
    [JsonPropertyName("clientTime")]
    public long ClientTime { get; set; }
}

public class PongPayload
{
    [JsonPropertyName("clientTime")]
    public long ClientTime { get; set; }

    [JsonPropertyName("serverTime")]
    public long ServerTime { get; set; }
}

public class ServerHelloPayload
{
    [JsonPropertyName("serverName")]
    public string ServerName { get; set; } = string.Empty;

    [JsonPropertyName("version")]
    public string Version { get; set; } = "1.0.0";

    [JsonPropertyName("os")]
    public string Os { get; set; } = string.Empty;

    [JsonPropertyName("capabilities")]
    public List<string> Capabilities { get; set; } = new();
}

public class ErrorPayload
{
    [JsonPropertyName("code")]
    public string Code { get; set; } = string.Empty;

    [JsonPropertyName("message")]
    public string Message { get; set; } = string.Empty;

    [JsonPropertyName("originalAction")]
    public string? OriginalAction { get; set; }
}

public class MouseMovePayload
{
    [JsonPropertyName("dx")]
    public int Dx { get; set; }

    [JsonPropertyName("dy")]
    public int Dy { get; set; }
}

public class MouseClickPayload
{
    [JsonPropertyName("button")]
    public string Button { get; set; } = "left";

    [JsonPropertyName("double")]
    public bool Double { get; set; }
}

public class MouseScrollPayload
{
    [JsonPropertyName("dx")]
    public int Dx { get; set; }

    [JsonPropertyName("dy")]
    public int Dy { get; set; }
}

public class KeyboardTextPayload
{
    [JsonPropertyName("text")]
    public string Text { get; set; } = string.Empty;
}

public class KeyboardKeyPayload
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;
}

public class KeyboardShortcutPayload
{
    [JsonPropertyName("keys")]
    public string[] Keys { get; set; } = Array.Empty<string>();
}

public class VolumeSetMasterPayload
{
    [JsonPropertyName("volume")]
    public float Volume { get; set; } // 0 - 100

    [JsonPropertyName("mute")]
    public bool? Mute { get; set; }
}

public class VolumeSetSessionPayload
{
    [JsonPropertyName("sessionId")]
    public string SessionId { get; set; } = string.Empty;

    [JsonPropertyName("volume")]
    public float Volume { get; set; } // 0 - 100

    [JsonPropertyName("mute")]
    public bool? Mute { get; set; }
}

public class AudioSessionItem
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = string.Empty;

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("processId")]
    public int ProcessId { get; set; }

    [JsonPropertyName("volume")]
    public float Volume { get; set; }

    [JsonPropertyName("isMuted")]
    public bool IsMuted { get; set; }
}

public class VolumeStatePayload
{
    [JsonPropertyName("masterVolume")]
    public float MasterVolume { get; set; }

    [JsonPropertyName("isMuted")]
    public bool IsMuted { get; set; }

    [JsonPropertyName("sessions")]
    public List<AudioSessionItem> Sessions { get; set; } = new();
}

public class MediaActionPayload
{
    [JsonPropertyName("action")]
    public string Action { get; set; } = string.Empty; // play, pause, playPause, next, previous, stop
}

public class MediaNowPlayingPayload
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("artist")]
    public string Artist { get; set; } = string.Empty;

    [JsonPropertyName("album")]
    public string Album { get; set; } = string.Empty;

    [JsonPropertyName("isPlaying")]
    public bool IsPlaying { get; set; }

    [JsonPropertyName("sourceApp")]
    public string? SourceApp { get; set; }
}


using System.Text.Json.Serialization;

namespace RemoteAgent.Platform.Screen;

public class ScreenMonitorInfo
{
    [JsonPropertyName("index")]
    public int Index { get; set; }

    [JsonPropertyName("deviceName")]
    public string DeviceName { get; set; } = string.Empty;

    [JsonPropertyName("width")]
    public int Width { get; set; }

    [JsonPropertyName("height")]
    public int Height { get; set; }

    [JsonPropertyName("isPrimary")]
    public bool IsPrimary { get; set; }
}

public class CapturedFrame : IDisposable
{
    public uint SequenceNumber { get; set; }
    public byte[] Data { get; set; } = Array.Empty<byte>();
    public int DataLength { get; set; }
    public int DesktopWidth { get; set; }
    public int DesktopHeight { get; set; }
    public ushort NormalizedCursorX { get; set; } // 0 - 65535 (mapped to 0.0 - 1.0)
    public ushort NormalizedCursorY { get; set; } // 0 - 65535
    public bool CursorVisible { get; set; }
    public long CaptureDurationMs { get; set; }
    public long EncodeDurationMs { get; set; }
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    public void Dispose()
    {
        // Reserved for unmanaged buffer pooling if needed
    }
}

public interface IScreenCaptureEngine : IDisposable
{
    List<ScreenMonitorInfo> GetMonitors();
    CapturedFrame? CaptureFrame(int monitorIndex, float scale, int jpegQuality, uint sequenceNumber);
}

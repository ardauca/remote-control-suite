namespace RemoteAgent.Security;

public static class SecurityCapabilities
{
    public const string InputControl = "input.control";
    public const string MediaControl = "media.control";
    public const string VolumeControl = "volume.control";
    public const string PowerControl = "power.control";
    public const string ScreenRead = "screen.read";

    public static readonly IReadOnlyList<string> All = new[]
    {
        InputControl,
        MediaControl,
        VolumeControl,
        PowerControl,
        ScreenRead
    };

    public static string? MapActionToCapability(string action)
    {
        if (action.StartsWith("mouse.", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("keyboard.", StringComparison.OrdinalIgnoreCase))
        {
            return InputControl;
        }

        if (action.StartsWith("volume.", StringComparison.OrdinalIgnoreCase))
        {
            return VolumeControl;
        }

        if (action.StartsWith("media.", StringComparison.OrdinalIgnoreCase))
        {
            return MediaControl;
        }

        if (action.StartsWith("power.", StringComparison.OrdinalIgnoreCase) ||
            action.Equals("system.launchApp", StringComparison.OrdinalIgnoreCase))
        {
            return PowerControl;
        }

        if (action.StartsWith("screen.", StringComparison.OrdinalIgnoreCase))
        {
            if (action.Equals("screen.touch", StringComparison.OrdinalIgnoreCase))
            {
                return InputControl;
            }
            return ScreenRead;
        }

        return null;
    }
}

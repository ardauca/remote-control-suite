namespace RemoteAgent.Network.Protocol;

public static class ActionTypes
{
    public const string SystemPing = "system.ping";
    public const string SystemPong = "system.pong";
    public const string SystemHello = "system.hello";
    public const string SystemError = "system.error";

    // Mouse & Touchpad (Phase 3)
    public const string MouseMove = "mouse.move";
    public const string MouseClick = "mouse.click";
    public const string MouseDown = "mouse.down";
    public const string MouseUp = "mouse.up";
    public const string MouseScroll = "mouse.scroll";

    // Keyboard & Modifiers (Phase 4)
    public const string KeyboardText = "keyboard.text";
    public const string KeyboardKeyDown = "keyboard.keyDown";
    public const string KeyboardKeyUp = "keyboard.keyUp";
    public const string KeyboardShortcut = "keyboard.shortcut";
    public const string KeyboardReleaseAll = "keyboard.releaseAll";

    // Media & Volume (Phase 5)
    public const string VolumeSetMaster = "volume.setMaster";
    public const string VolumeSetSession = "volume.setSession";
    public const string VolumeRequestState = "volume.requestState";
    public const string VolumeState = "volume.state";

    public const string MediaAction = "media.action";
    public const string MediaRequestNowPlaying = "media.requestNowPlaying";
    public const string MediaNowPlaying = "media.nowPlaying";

    // Power & System Controls (Phase 6)
    public const string PowerAction = "power.action";
    public const string PowerSchedule = "power.schedule";
    public const string PowerCancel = "power.cancel";
    public const string PowerRequestStatus = "power.requestStatus";
    public const string PowerStatus = "power.status";

    // Auth & Pairing (WAN Security)
    public const string AuthLogin = "auth.login";
    public const string AuthResult = "auth.result";

    // Screen Mirroring & Stream (Phase 7)
    public const string ScreenStart = "screen.start";
    public const string ScreenStop = "screen.stop";
    public const string ScreenSnapshot = "screen.snapshot";
    public const string ScreenTouch = "screen.touch";
    public const string ScreenTelemetry = "screen.telemetry";
    public const string ScreenMonitors = "screen.monitors";
}

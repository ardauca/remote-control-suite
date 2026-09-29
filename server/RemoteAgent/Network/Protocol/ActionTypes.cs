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

    // Future capabilities (Phase 5+)
    public const string MediaAction = "media.action";
    public const string VolumeSet = "volume.set";
    public const string PowerAction = "power.action";
}

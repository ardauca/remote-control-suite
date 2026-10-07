namespace RemoteAgent.Platform.Input;

public interface IInputSimulator
{
    // Mouse
    void MoveMouseRelative(int dx, int dy);
    void MoveMouseAbsolute(int x, int y);
    void MouseDown(string button, string? connectionId = null);
    void MouseUp(string button, string? connectionId = null);
    void MouseClick(string button, bool isDouble = false);
    void MouseScroll(int deltaX, int deltaY);

    // Keyboard & Modifiers
    bool IsValidKey(string key);
    void SendText(string text);
    void KeyDown(string key, string? connectionId = null);
    void KeyUp(string key, string? connectionId = null);
    void ExecuteShortcut(string[] keys);
    void ReleaseConnectionKeys(string connectionId);
    void ReleaseAllKeys();
}

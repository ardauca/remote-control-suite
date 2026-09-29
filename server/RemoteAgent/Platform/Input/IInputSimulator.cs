namespace RemoteAgent.Platform.Input;

public interface IInputSimulator
{
    // Mouse
    void MoveMouseRelative(int dx, int dy);
    void MouseDown(string button);
    void MouseUp(string button);
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

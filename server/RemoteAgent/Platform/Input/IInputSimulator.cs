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
    void SendText(string text);
    void KeyDown(string key);
    void KeyUp(string key);
    void ExecuteShortcut(string[] keys);
    void ReleaseAllKeys();
}

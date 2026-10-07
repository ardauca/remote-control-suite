using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace RemoteAgent.Platform.Input;

public class WindowsInputSimulator : IInputSimulator
{
    private readonly ILogger<WindowsInputSimulator> _logger;
    private static readonly int InputSize = Marshal.SizeOf<NativeMethods.INPUT>();

    // Track keys held per connection: connectionId -> (vk -> pressTime)
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<byte, DateTime>> _connectionKeys = new();
    // Track mouse buttons held per connection: connectionId -> (buttonName -> byte dummy)
    private readonly ConcurrentDictionary<string, ConcurrentDictionary<string, byte>> _connectionMouseButtons = new();
    // Track total active count per key across all connections
    private readonly ConcurrentDictionary<byte, int> _activeKeyRefCounts = new();
    private readonly System.Threading.Timer _staleKeyTimer;
    private static readonly TimeSpan MaxKeyHoldDuration = TimeSpan.FromSeconds(20);

    private static readonly Dictionary<string, (byte vk, bool extended)> KeyMap = new(StringComparer.OrdinalIgnoreCase)
    {
        // Modifiers
        { "CTRL", (0x11, false) },
        { "CONTROL", (0x11, false) },
        { "ALT", (0x12, false) },
        { "MENU", (0x12, false) },
        { "SHIFT", (0x10, false) },
        { "WIN", (0x5B, true) },
        { "WINDOWS", (0x5B, true) },
        { "LWIN", (0x5B, true) },
        { "RWIN", (0x5C, true) },

        // Common Keys
        { "ENTER", (0x0D, false) },
        { "RETURN", (0x0D, false) },
        { "BACKSPACE", (0x08, false) },
        { "BACK", (0x08, false) },
        { "TAB", (0x09, false) },
        { "ESC", (0x1B, false) },
        { "ESCAPE", (0x1B, false) },
        { "SPACE", (0x20, false) },
        { "DELETE", (0x2E, true) },
        { "DEL", (0x2E, true) },
        { "INSERT", (0x2D, true) },
        { "INS", (0x2D, true) },
        { "HOME", (0x24, true) },
        { "END", (0x23, true) },
        { "PAGEUP", (0x21, true) },
        { "PGUP", (0x21, true) },
        { "PAGEDOWN", (0x22, true) },
        { "PGDN", (0x22, true) },

        // Arrow Keys
        { "UP", (0x26, true) },
        { "ARROWUP", (0x26, true) },
        { "DOWN", (0x28, true) },
        { "ARROWDOWN", (0x28, true) },
        { "LEFT", (0x25, true) },
        { "ARROWLEFT", (0x25, true) },
        { "RIGHT", (0x27, true) },
        { "ARROWRIGHT", (0x27, true) },

        // Lock & System Keys
        { "CAPSLOCK", (0x14, false) },
        { "CAPITAL", (0x14, false) },
        { "NUMLOCK", (0x90, true) },
        { "SCROLLLOCK", (0x91, false) },
        { "SCROLL", (0x91, false) },
        { "PRINTSCREEN", (0x2C, true) },
        { "PRTSC", (0x2C, true) },
        { "PAUSE", (0x13, false) },
        { "APPS", (0x5D, true) },
        { "CONTEXTMENU", (0x5D, true) },

        // Function Keys F1-F12
        { "F1", (0x70, false) },
        { "F2", (0x71, false) },
        { "F3", (0x72, false) },
        { "F4", (0x73, false) },
        { "F5", (0x74, false) },
        { "F6", (0x75, false) },
        { "F7", (0x76, false) },
        { "F8", (0x77, false) },
        { "F9", (0x78, false) },
        { "F10", (0x79, false) },
        { "F11", (0x7A, false) },
        { "F12", (0x7B, false) },
    };

    static WindowsInputSimulator()
    {
        // Letters A-Z
        for (char c = 'A'; c <= 'Z'; c++)
        {
            KeyMap[c.ToString()] = ((byte)c, false);
        }
        // Numbers 0-9
        for (char c = '0'; c <= '9'; c++)
        {
            KeyMap[c.ToString()] = ((byte)c, false);
        }
    }

    public WindowsInputSimulator(ILogger<WindowsInputSimulator> logger)
    {
        _logger = logger;
        _staleKeyTimer = new System.Threading.Timer(CheckStaleKeys, null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
    }

    public bool IsValidKey(string key) => !string.IsNullOrWhiteSpace(key) && KeyMap.ContainsKey(key.Trim());

    // ================= MOUSE CONTROLS =================

    public void MoveMouseRelative(int dx, int dy)
    {
        if (dx == 0 && dy == 0) return;

        var input = new NativeMethods.INPUT
        {
            type = NativeMethods.INPUT_MOUSE,
            u = new NativeMethods.InputUnion
            {
                mi = new NativeMethods.MOUSEINPUT
                {
                    dx = dx,
                    dy = dy,
                    dwFlags = (uint)NativeMethods.MouseEventFlags.MOVE,
                    mouseData = 0,
                    time = 0,
                    dwExtraInfo = UIntPtr.Zero
                }
            }
        };
        NativeMethods.SendInput(1, new[] { input }, InputSize);
    }

    public void MoveMouseAbsolute(int x, int y)
    {
        NativeMethods.SetCursorPos(x, y);
    }

    public void MouseDown(string button, string? connectionId = null)
    {
        string normBtn = button?.ToLowerInvariant() ?? "left";
        if (!string.IsNullOrEmpty(connectionId))
        {
            var btnMap = _connectionMouseButtons.GetOrAdd(connectionId, _ => new ConcurrentDictionary<string, byte>(StringComparer.OrdinalIgnoreCase));
            btnMap[normBtn] = 1;
        }

        uint flag = normBtn switch
        {
            "right" => (uint)NativeMethods.MouseEventFlags.RIGHTDOWN,
            "middle" => (uint)NativeMethods.MouseEventFlags.MIDDLEDOWN,
            _ => (uint)NativeMethods.MouseEventFlags.LEFTDOWN
        };
        NativeMethods.mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }

    public void MouseUp(string button, string? connectionId = null)
    {
        string normBtn = button?.ToLowerInvariant() ?? "left";
        if (!string.IsNullOrEmpty(connectionId) && _connectionMouseButtons.TryGetValue(connectionId, out var btnMap))
        {
            btnMap.TryRemove(normBtn, out _);
        }

        uint flag = normBtn switch
        {
            "right" => (uint)NativeMethods.MouseEventFlags.RIGHTUP,
            "middle" => (uint)NativeMethods.MouseEventFlags.MIDDLEUP,
            _ => (uint)NativeMethods.MouseEventFlags.LEFTUP
        };
        NativeMethods.mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }

    public void MouseClick(string button, bool isDouble = false)
    {
        MouseDown(button);
        MouseUp(button);

        if (isDouble)
        {
            Thread.Sleep(30);
            MouseDown(button);
            MouseUp(button);
        }
    }

    public void MouseScroll(int deltaX, int deltaY)
    {
        if (deltaY != 0)
        {
            NativeMethods.mouse_event((uint)NativeMethods.MouseEventFlags.WHEEL, 0, 0, (uint)(deltaY * 120), UIntPtr.Zero);
        }

        if (deltaX != 0)
        {
            NativeMethods.mouse_event((uint)NativeMethods.MouseEventFlags.HWHEEL, 0, 0, (uint)(deltaX * 120), UIntPtr.Zero);
        }
    }

    // ================= KEYBOARD & UNICODE =================

    public void SendText(string text)
    {
        if (string.IsNullOrEmpty(text)) return;

        var inputs = new List<NativeMethods.INPUT>(text.Length * 2);

        foreach (char c in text)
        {
            // Enter key special handling in text stream
            if (c == '\n' || c == '\r')
            {
                inputs.Add(CreateKeyInput(0x0D, false, false));
                inputs.Add(CreateKeyInput(0x0D, true, false));
                continue;
            }

            // Standard Unicode character (Turkish: ç, ğ, ı, ö, ş, ü, emojis, symbols)
            inputs.Add(new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                u = new NativeMethods.InputUnion
                {
                    ki = new NativeMethods.KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = (ushort)c,
                        dwFlags = NativeMethods.KEYEVENTF_UNICODE,
                        time = 0,
                        dwExtraInfo = UIntPtr.Zero
                    }
                }
            });

            inputs.Add(new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                u = new NativeMethods.InputUnion
                {
                    ki = new NativeMethods.KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = (ushort)c,
                        dwFlags = NativeMethods.KEYEVENTF_UNICODE | NativeMethods.KEYEVENTF_KEYUP,
                        time = 0,
                        dwExtraInfo = UIntPtr.Zero
                    }
                }
            });
        }

        NativeMethods.SendInput((uint)inputs.Count, inputs.ToArray(), InputSize);
    }

    public void KeyDown(string key, string? connectionId = null)
    {
        if (!KeyMap.TryGetValue(key.Trim(), out var mapping))
        {
            _logger.LogWarning("Unknown key requested for KeyDown: {Key}", key);
            return;
        }

        if (!string.IsNullOrEmpty(connectionId))
        {
            var connDict = _connectionKeys.GetOrAdd(connectionId, _ => new ConcurrentDictionary<byte, DateTime>());
            connDict[mapping.vk] = DateTime.UtcNow;

            int refCount = _activeKeyRefCounts.AddOrUpdate(mapping.vk, 1, (_, count) => count + 1);
            if (refCount == 1)
            {
                var input = CreateKeyInput(mapping.vk, isKeyUp: false, isExtended: mapping.extended);
                NativeMethods.SendInput(1, new[] { input }, InputSize);
            }
        }
        else
        {
            _activeKeyRefCounts.AddOrUpdate(mapping.vk, 1, (_, count) => count + 1);
            var input = CreateKeyInput(mapping.vk, isKeyUp: false, isExtended: mapping.extended);
            NativeMethods.SendInput(1, new[] { input }, InputSize);
        }
    }

    public void KeyUp(string key, string? connectionId = null)
    {
        if (!KeyMap.TryGetValue(key.Trim(), out var mapping))
        {
            _logger.LogWarning("Unknown key requested for KeyUp: {Key}", key);
            return;
        }

        if (!string.IsNullOrEmpty(connectionId))
        {
            if (_connectionKeys.TryGetValue(connectionId, out var connDict))
            {
                if (connDict.TryRemove(mapping.vk, out _))
                {
                    int remaining = _activeKeyRefCounts.AddOrUpdate(mapping.vk, 0, (_, count) => Math.Max(0, count - 1));
                    if (remaining == 0)
                    {
                        var input = CreateKeyInput(mapping.vk, isKeyUp: true, isExtended: mapping.extended);
                        NativeMethods.SendInput(1, new[] { input }, InputSize);
                    }
                }
            }
        }
        else
        {
            _activeKeyRefCounts.AddOrUpdate(mapping.vk, 0, (_, count) => Math.Max(0, count - 1));
            var input = CreateKeyInput(mapping.vk, isKeyUp: true, isExtended: mapping.extended);
            NativeMethods.SendInput(1, new[] { input }, InputSize);
        }
    }

    public void ReleaseConnectionKeys(string connectionId)
    {
        if (string.IsNullOrEmpty(connectionId)) return;

        // Release keyboard keys held by this connection
        if (_connectionKeys.TryRemove(connectionId, out var heldKeys))
        {
            foreach (var vk in heldKeys.Keys)
            {
                int remaining = _activeKeyRefCounts.AddOrUpdate(vk, 0, (_, count) => Math.Max(0, count - 1));
                if (remaining == 0)
                {
                    NativeMethods.keybd_event(vk, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                }
            }
            _logger.LogInformation("Released {Count} held keys for disconnected client {ConnectionId}", heldKeys.Count, connectionId);
        }

        // Release mouse buttons held by this connection
        if (_connectionMouseButtons.TryRemove(connectionId, out var heldButtons))
        {
            foreach (var btn in heldButtons.Keys)
            {
                MouseUp(btn);
            }
            _logger.LogInformation("Released {Count} held mouse buttons for disconnected client {ConnectionId}", heldButtons.Count, connectionId);
        }
    }

    private void CheckStaleKeys(object? state)
    {
        try
        {
            var now = DateTime.UtcNow;
            foreach (var (connId, keys) in _connectionKeys)
            {
                foreach (var (vk, pressTime) in keys)
                {
                    if (now - pressTime > MaxKeyHoldDuration)
                    {
                        if (keys.TryRemove(vk, out _))
                        {
                            int remaining = _activeKeyRefCounts.AddOrUpdate(vk, 0, (_, count) => Math.Max(0, count - 1));
                            if (remaining == 0)
                            {
                                NativeMethods.keybd_event(vk, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
                            }
                            _logger.LogWarning("Safety timeout: Auto-released stale key 0x{Vk:X2} for connection {ConnectionId}", vk, connId);
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error checking stale keys");
        }
    }

    public void ExecuteShortcut(string[] keys)
    {
        if (keys == null || keys.Length == 0) return;

        var validMappings = new List<(byte vk, bool extended)>();
        foreach (var key in keys)
        {
            if (KeyMap.TryGetValue(key.Trim(), out var mapping))
            {
                validMappings.Add(mapping);
            }
            else
            {
                _logger.LogWarning("Shortcut contains unrecognized key: {Key}", key);
                return; // Whitelist security: Abort if any key is invalid
            }
        }

        // 1. Press keys in sequence
        foreach (var m in validMappings)
        {
            var down = CreateKeyInput(m.vk, isKeyUp: false, isExtended: m.extended);
            NativeMethods.SendInput(1, new[] { down }, InputSize);
            Thread.Sleep(10);
        }

        Thread.Sleep(15);

        // 2. Release keys in reverse order
        for (int i = validMappings.Count - 1; i >= 0; i--)
        {
            var m = validMappings[i];
            var up = CreateKeyInput(m.vk, isKeyUp: true, isExtended: m.extended);
            NativeMethods.SendInput(1, new[] { up }, InputSize);
            Thread.Sleep(10);
        }
    }

    public void ReleaseAllKeys()
    {
        _connectionKeys.Clear();
        _connectionMouseButtons.Clear();
        _activeKeyRefCounts.Clear();

        // 1. Unconditionally release critical modifiers to prevent sticky keys
        byte[] criticalModifiers = { 0x11 /* Ctrl */, 0x12 /* Alt */, 0x10 /* Shift */, 0x5B /* LWin */, 0x5C /* RWin */ };
        foreach (var mod in criticalModifiers)
        {
            NativeMethods.keybd_event(mod, 0, NativeMethods.KEYEVENTF_KEYUP, UIntPtr.Zero);
        }

        // 2. Unconditionally release all mouse buttons if locked
        NativeMethods.mouse_event((uint)NativeMethods.MouseEventFlags.LEFTUP, 0, 0, 0, UIntPtr.Zero);
        NativeMethods.mouse_event((uint)NativeMethods.MouseEventFlags.RIGHTUP, 0, 0, 0, UIntPtr.Zero);
        NativeMethods.mouse_event((uint)NativeMethods.MouseEventFlags.MIDDLEUP, 0, 0, 0, UIntPtr.Zero);

        _logger.LogInformation("All remote held keys, mouse buttons, and modifiers released safely.");
    }

    private static NativeMethods.INPUT CreateKeyInput(byte vk, bool isKeyUp, bool isExtended)
    {
        uint flags = 0;
        if (isKeyUp) flags |= NativeMethods.KEYEVENTF_KEYUP;
        if (isExtended) flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;

        return new NativeMethods.INPUT
        {
            type = NativeMethods.INPUT_KEYBOARD,
            u = new NativeMethods.InputUnion
            {
                ki = new NativeMethods.KEYBDINPUT
                {
                    wVk = vk,
                    wScan = 0,
                    dwFlags = flags,
                    time = 0,
                    dwExtraInfo = UIntPtr.Zero
                }
            }
        };
    }
}

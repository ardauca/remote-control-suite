using System.Windows.Automation;
using System.Text;

namespace RemoteAgent.Platform.Input;

public static class FocusedTextInputDetector
{
    public static bool IsTextInputFocused()
    {
        try
        {
            var focused = AutomationElement.FocusedElement;
            if (IsEditableOrAncestor(focused)) return true;

            if (NativeMethods.GetCursorPos(out var cursorPosition))
            {
                var target = AutomationElement.FromPoint(new System.Windows.Point(cursorPosition.X, cursorPosition.Y));
                if (IsEditableOrAncestor(target)) return true;
            }
        }
        catch
        {
            // UI Automation providers can disappear while a window is changing focus.
        }

        // Some apps expose text focus through the Win32 caret but not through UI Automation.
        var threadInfo = new NativeMethods.GUITHREADINFO
        {
            cbSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<NativeMethods.GUITHREADINFO>()
        };
        if (!NativeMethods.GetGUIThreadInfo(0, ref threadInfo)) return false;
        if (threadInfo.hwndCaret != IntPtr.Zero) return true;
        if (threadInfo.hwndFocus == IntPtr.Zero) return false;

        var className = new StringBuilder(128);
        NativeMethods.GetClassName(threadInfo.hwndFocus, className, className.Capacity);
        return className.ToString().Contains("EDIT", StringComparison.OrdinalIgnoreCase) ||
               className.ToString().Contains("TEXTBOX", StringComparison.OrdinalIgnoreCase) ||
               className.ToString().Contains("RICHEDIT", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsEditableOrAncestor(AutomationElement? element)
    {
        var candidate = element;
        for (var depth = 0; candidate is not null && depth < 6; depth++)
        {
            try
            {
                var current = candidate.Current;
                if (current.ControlType == ControlType.Edit)
                {
                    if (candidate.TryGetCurrentPattern(ValuePattern.Pattern, out var pattern))
                    {
                        return !((ValuePattern)pattern).Current.IsReadOnly;
                    }

                    return current.IsKeyboardFocusable;
                }

                if (current.ClassName.StartsWith("Edit", StringComparison.OrdinalIgnoreCase) ||
                    current.ClassName.Contains("RichEdit", StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }

                candidate = TreeWalker.ControlViewWalker.GetParent(candidate);
            }
            catch
            {
                return false;
            }
        }

        return false;
    }
}

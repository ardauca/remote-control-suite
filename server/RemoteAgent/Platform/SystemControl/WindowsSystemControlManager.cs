using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using RemoteAgent.Network.Protocol;
using RemoteAgent.Platform.Input;

namespace RemoteAgent.Platform.SystemControl;

public class WindowsSystemControlManager : ISystemControlManager
{
    private readonly ILogger<WindowsSystemControlManager> _logger;
    private readonly IInputSimulator _inputSimulator;
    private readonly object _lock = new();

    private System.Threading.Timer? _countdownTimer;
    private PowerStatusPayload _currentStatus = new()
    {
        IsActive = false,
        Action = "none",
        TotalSeconds = 0,
        RemainingSeconds = 0
    };

    public event Action<PowerStatusPayload>? ShutdownStatusChanged;

    #region Win32 P/Invoke
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool LockWorkStation();

    [DllImport("Powrprof.dll", SetLastError = true)]
    private static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent);

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    private const int HWND_BROADCAST = 0xFFFF;
    private const uint WM_SYSCOMMAND = 0x0112;
    private const int SC_MONITORPOWER = 0xF170;
    private const int MONITOR_OFF = 2;
    #endregion

    public WindowsSystemControlManager(ILogger<WindowsSystemControlManager> logger, IInputSimulator inputSimulator)
    {
        _logger = logger;
        _inputSimulator = inputSimulator;
    }

    public void LockWorkstation()
    {
        try
        {
            _logger.LogInformation("Executing Win32 LockWorkStation...");
            LockWorkStation();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to lock workstation");
        }
    }

    public void Sleep()
    {
        try
        {
            _logger.LogInformation("Executing system sleep (suspend)...");
            SetSuspendState(false, true, false);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to enter sleep state");
        }
    }

    public void TurnOffDisplay()
    {
        try
        {
            _logger.LogInformation("Turning off display monitors...");
            SendMessage(new IntPtr(HWND_BROADCAST), WM_SYSCOMMAND, new IntPtr(SC_MONITORPOWER), new IntPtr(MONITOR_OFF));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to turn off display");
        }
    }

    public void OpenTaskManager()
    {
        try
        {
            _logger.LogInformation("Launching Windows Task Manager...");
            Process.Start(new ProcessStartInfo
            {
                FileName = "taskmgr.exe",
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to launch Task Manager");
        }
    }

    public void ToggleDesktop()
    {
        try
        {
            _logger.LogInformation("Toggling Desktop (Win + D)...");
            _inputSimulator.ExecuteShortcut(new[] { "WIN", "D" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to toggle desktop");
        }
    }

    public void OpenTaskView()
    {
        try
        {
            _logger.LogInformation("Opening Windows Task View (Win + Tab)...");
            _inputSimulator.ExecuteShortcut(new[] { "WIN", "TAB" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to open task view");
        }
    }

    public void TakeScreenshot()
    {
        try
        {
            _logger.LogInformation("Triggering Snipping Tool / Screenshot (Win + Shift + S)...");
            _inputSimulator.ExecuteShortcut(new[] { "WIN", "SHIFT", "S" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to trigger screenshot shortcut");
        }
    }

    public bool LaunchApp(string appName)
    {
        try
        {
            string? normalized = appName?.Trim().ToLowerInvariant();
            _logger.LogInformation("LaunchApp requested: {AppName}", normalized);

            switch (normalized)
            {
                case "chrome":
                    // Try direct chrome or cmd start
                    try
                    {
                        Process.Start(new ProcessStartInfo { FileName = "chrome.exe", UseShellExecute = true });
                        return true;
                    }
                    catch
                    {
                        Process.Start(new ProcessStartInfo { FileName = "cmd.exe", Arguments = "/c start chrome", UseShellExecute = true, CreateNoWindow = true });
                        return true;
                    }

                case "spotify":
                    Process.Start(new ProcessStartInfo { FileName = "spotify:", UseShellExecute = true });
                    return true;

                case "notepad":
                    Process.Start(new ProcessStartInfo { FileName = "notepad.exe", UseShellExecute = true });
                    return true;

                case "calc" or "calculator":
                    Process.Start(new ProcessStartInfo { FileName = "calc.exe", UseShellExecute = true });
                    return true;

                case "explorer" or "files":
                    Process.Start(new ProcessStartInfo { FileName = "explorer.exe", UseShellExecute = true });
                    return true;

                case "edge" or "msedge":
                    Process.Start(new ProcessStartInfo { FileName = "msedge.exe", UseShellExecute = true });
                    return true;

                case "terminal" or "cmd":
                    try
                    {
                        Process.Start(new ProcessStartInfo { FileName = "wt.exe", UseShellExecute = true });
                    }
                    catch
                    {
                        Process.Start(new ProcessStartInfo { FileName = "cmd.exe", UseShellExecute = true });
                    }
                    return true;

                case "taskmanager" or "taskmgr":
                    OpenTaskManager();
                    return true;

                case "discord":
                    Process.Start(new ProcessStartInfo { FileName = "discord:", UseShellExecute = true });
                    return true;

                case "steam":
                    Process.Start(new ProcessStartInfo { FileName = "steam:", UseShellExecute = true });
                    return true;

                case "vscode" or "code":
                    Process.Start(new ProcessStartInfo { FileName = "cmd.exe", Arguments = "/c code", UseShellExecute = true, CreateNoWindow = true });
                    return true;

                default:
                    _logger.LogWarning("LaunchApp: Unrecognized application '{AppName}'", appName);
                    return false;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to launch application '{AppName}'", appName);
            return false;
        }
    }

    public void ScheduleShutdown(int timeoutSeconds)
    {
        lock (_lock)
        {
            try
            {
                _logger.LogInformation("Scheduling system shutdown in {Seconds}s ({Minutes}m)...", timeoutSeconds, timeoutSeconds / 60);
                
                // Cancel any existing shutdown before scheduling new one
                RunCliProcess("shutdown.exe", "/a");

                RunCliProcess("shutdown.exe", $"/s /t {timeoutSeconds} /c \"Scheduled shutdown from iPhone Remote Control Suite\"");

                _countdownTimer?.Dispose();
                _currentStatus = new PowerStatusPayload
                {
                    IsActive = true,
                    Action = "shutdown",
                    TotalSeconds = timeoutSeconds,
                    RemainingSeconds = timeoutSeconds,
                    TargetTimeUtc = DateTime.UtcNow.AddSeconds(timeoutSeconds)
                };

                _countdownTimer = new System.Threading.Timer(OnCountdownTick, null, 1000, 1000);
                ShutdownStatusChanged?.Invoke(_currentStatus);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to schedule shutdown");
            }
        }
    }

    public void ScheduleRestart(int timeoutSeconds)
    {
        lock (_lock)
        {
            try
            {
                _logger.LogInformation("Scheduling system restart in {Seconds}s ({Minutes}m)...", timeoutSeconds, timeoutSeconds / 60);
                
                RunCliProcess("shutdown.exe", "/a");
                RunCliProcess("shutdown.exe", $"/r /t {timeoutSeconds} /c \"Scheduled restart from iPhone Remote Control Suite\"");

                _countdownTimer?.Dispose();
                _currentStatus = new PowerStatusPayload
                {
                    IsActive = true,
                    Action = "restart",
                    TotalSeconds = timeoutSeconds,
                    RemainingSeconds = timeoutSeconds,
                    TargetTimeUtc = DateTime.UtcNow.AddSeconds(timeoutSeconds)
                };

                _countdownTimer = new System.Threading.Timer(OnCountdownTick, null, 1000, 1000);
                ShutdownStatusChanged?.Invoke(_currentStatus);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to schedule restart");
            }
        }
    }

    public void CancelScheduledShutdown()
    {
        lock (_lock)
        {
            try
            {
                _logger.LogInformation("Cancelling scheduled shutdown / restart...");
                RunCliProcess("shutdown.exe", "/a");

                _countdownTimer?.Dispose();
                _countdownTimer = null;

                _currentStatus = new PowerStatusPayload
                {
                    IsActive = false,
                    Action = "none",
                    TotalSeconds = 0,
                    RemainingSeconds = 0,
                    TargetTimeUtc = null
                };

                ShutdownStatusChanged?.Invoke(_currentStatus);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to cancel scheduled shutdown");
            }
        }
    }

    public void ShutdownNow()
    {
        try
        {
            _logger.LogWarning("Initiating immediate system shutdown (shutdown /s /t 0 /f)...");
            RunCliProcess("shutdown.exe", "/s /t 0 /f");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to shutdown immediately");
        }
    }

    public void RestartNow()
    {
        try
        {
            _logger.LogWarning("Initiating immediate system restart (shutdown /r /t 0 /f)...");
            RunCliProcess("shutdown.exe", "/r /t 0 /f");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to restart immediately");
        }
    }

    public PowerStatusPayload GetCurrentPowerStatus()
    {
        lock (_lock)
        {
            return new PowerStatusPayload
            {
                IsActive = _currentStatus.IsActive,
                Action = _currentStatus.Action,
                TotalSeconds = _currentStatus.TotalSeconds,
                RemainingSeconds = _currentStatus.RemainingSeconds,
                TargetTimeUtc = _currentStatus.TargetTimeUtc
            };
        }
    }

    private void OnCountdownTick(object? state)
    {
        lock (_lock)
        {
            if (!_currentStatus.IsActive || _currentStatus.TargetTimeUtc == null)
            {
                _countdownTimer?.Dispose();
                _countdownTimer = null;
                return;
            }

            var remaining = (int)Math.Max(0, (_currentStatus.TargetTimeUtc.Value - DateTime.UtcNow).TotalSeconds);
            _currentStatus.RemainingSeconds = remaining;

            if (remaining <= 0)
            {
                _countdownTimer?.Dispose();
                _countdownTimer = null;
            }

            ShutdownStatusChanged?.Invoke(_currentStatus);
        }
    }

    private static void RunCliProcess(string fileName, string args)
    {
        try
        {
            using var proc = Process.Start(new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = args,
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            });
            proc?.WaitForExit(3000);
        }
        catch
        {
            // Ignore benign errors like shutdown /a when no shutdown was active
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _countdownTimer?.Dispose();
            _countdownTimer = null;
        }
    }
}

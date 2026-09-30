using RemoteAgent.Network.Protocol;

namespace RemoteAgent.Platform.SystemControl;

public interface ISystemControlManager : IDisposable
{
    event Action<PowerStatusPayload>? ShutdownStatusChanged;

    void LockWorkstation();
    void Sleep();
    void TurnOffDisplay();
    void OpenTaskManager();
    void ToggleDesktop();
    void OpenTaskView();
    void TakeScreenshot();

    void ScheduleShutdown(int timeoutSeconds);
    void ScheduleRestart(int timeoutSeconds);
    void CancelScheduledShutdown();
    void ShutdownNow();
    void RestartNow();
    bool LaunchApp(string appName);

    PowerStatusPayload GetCurrentPowerStatus();
}

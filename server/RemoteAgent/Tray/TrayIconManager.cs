using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RemoteAgent.Configuration;
using RemoteAgent.Core;
using RemoteAgent.Network;

namespace RemoteAgent.Tray;

public class TrayIconManager : IDisposable
{
    private readonly ILogger<TrayIconManager> _logger;
    private readonly AgentOptions _options;
    private readonly AgentWebSocketManager _wsManager;
    private readonly Action _onExitRequested;

    private NotifyIcon? _notifyIcon;
    private ContextMenuStrip? _contextMenu;
    private ToolStripMenuItem? _connectionsMenuItem;
    private Thread? _trayThread;
    private ManualResetEventSlim? _initEvent;
    private bool _disposed;

    public TrayIconManager(
        ILogger<TrayIconManager> logger,
        IOptions<AgentOptions> options,
        AgentWebSocketManager wsManager,
        Action onExitRequested)
    {
        _logger = logger;
        _options = options.Value;
        _wsManager = wsManager;
        _onExitRequested = onExitRequested;
    }

    public void Start()
    {
        _initEvent = new ManualResetEventSlim(false);
        _trayThread = new Thread(RunTrayMessageLoop)
        {
            IsBackground = true,
            Name = "SystemTrayThread"
        };
        _trayThread.SetApartmentState(ApartmentState.STA);
        _trayThread.Start();

        _initEvent.Wait(TimeSpan.FromSeconds(5));
        _wsManager.ActiveConnectionsChanged += OnActiveConnectionsChanged;
        _logger.LogInformation("System Tray icon initialized successfully.");
    }

    private void RunTrayMessageLoop()
    {
        try
        {
            ApplicationConfiguration.Initialize();

            _contextMenu = new ContextMenuStrip();

            var titleItem = new ToolStripMenuItem($"Remote Suite ({_options.ServerName})")
            {
                Enabled = false,
                Font = new Font(Control.DefaultFont, FontStyle.Bold)
            };
            _contextMenu.Items.Add(titleItem);

            var portItem = new ToolStripMenuItem($"Listening Port: {_options.Port}")
            {
                Enabled = false
            };
            _contextMenu.Items.Add(portItem);

            _connectionsMenuItem = new ToolStripMenuItem("Connected Clients: 0")
            {
                Enabled = false
            };
            _contextMenu.Items.Add(_connectionsMenuItem);

            _contextMenu.Items.Add(new ToolStripSeparator());

            var openWebItem = new ToolStripMenuItem("Open Web Client in Browser", null, (s, e) =>
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = $"http://localhost:{_options.Port}",
                        UseShellExecute = true
                    });
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to open browser.");
                }
            });
            _contextMenu.Items.Add(openWebItem);

            var ipsItem = new ToolStripMenuItem("View Local Network IPs", null, (s, e) =>
            {
                var ips = SystemInfoHelper.GetLocalIpAddresses();
                var ipList = string.Join("\n", ips.Select(ip => $"http://{ip}:{_options.Port}"));
                MessageBox.Show(
                    $"Local Access URLs:\n\n{ipList}\n\nOpen any of these in Safari on your iPhone connected to the same Wi-Fi.",
                    "Remote Suite - LAN Addresses",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information);
            });
            _contextMenu.Items.Add(ipsItem);

            _contextMenu.Items.Add(new ToolStripSeparator());

            var exitItem = new ToolStripMenuItem("Exit Remote Suite", null, (s, e) =>
            {
                _logger.LogInformation("User requested exit from System Tray.");
                _onExitRequested();
                Application.ExitThread();
            });
            _contextMenu.Items.Add(exitItem);

            _notifyIcon = new NotifyIcon
            {
                Icon = SystemIcons.Application,
                ContextMenuStrip = _contextMenu,
                Text = $"Remote Suite - Port {_options.Port}",
                Visible = true
            };

            _notifyIcon.ShowBalloonTip(
                3000,
                "Remote Control Suite",
                $"Agent started on port {_options.Port}. Ready for connections.",
                ToolTipIcon.Info);

            _initEvent?.Set();
            Application.Run();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error running Tray message loop.");
        }
    }

    private void OnActiveConnectionsChanged(int count)
    {
        if (_notifyIcon == null || _connectionsMenuItem == null) return;

        try
        {
            if (_contextMenu != null && _contextMenu.IsHandleCreated)
            {
                _contextMenu.BeginInvoke(new Action(() =>
                {
                    _connectionsMenuItem.Text = $"Connected Clients: {count}";
                    _notifyIcon.Text = $"Remote Suite - {count} client(s) connected";
                }));
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Error updating tray menu connection count.");
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        _wsManager.ActiveConnectionsChanged -= OnActiveConnectionsChanged;

        if (_notifyIcon != null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _notifyIcon = null;
        }

        _contextMenu?.Dispose();
        _contextMenu = null;
    }
}

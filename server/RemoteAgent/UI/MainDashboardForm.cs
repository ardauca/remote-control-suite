using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using RemoteAgent.Configuration;
using RemoteAgent.Core;
using RemoteAgent.Network;

namespace RemoteAgent.UI;

public class MainDashboardForm : Form
{
    private readonly AgentOptions _options;
    private readonly AgentWebSocketManager _wsManager;
    private readonly IHostApplicationLifetime _lifetime;

    private NotifyIcon _notifyIcon = null!;
    private ContextMenuStrip _trayContextMenu = null!;
    private Label _statusLabel = null!;
    private Label _clientsCountLabel = null!;
    private ListBox _clientsListBox = null!;
    private ListBox _logListBox = null!;
    private TextBox _urlTextBox = null!;

    public MainDashboardForm(
        IOptions<AgentOptions> options,
        AgentWebSocketManager wsManager,
        IHostApplicationLifetime lifetime)
    {
        _options = options.Value;
        _wsManager = wsManager;
        _lifetime = lifetime;

        InitializeComponent();
        SetupTrayIcon();

        _wsManager.ActiveConnectionsChanged += OnActiveConnectionsChanged;
        AddLog($"Agent started on port {_options.Port}. Ready for connections.");
    }

    private void InitializeComponent()
    {
        Text = "Remote Control Suite - Windows Host";
        Size = new Size(680, 560);
        MinimumSize = new Size(640, 500);
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(15, 23, 42); // slate-900
        ForeColor = Color.FromArgb(248, 250, 252);
        Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);
        Icon = SystemIcons.Application;

        // Main Layout Container
        var mainLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 5,
            Padding = new Padding(16),
            BackColor = Color.FromArgb(15, 23, 42)
        };
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 60));  // Header
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 100)); // Info Card
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 35));   // Clients
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 65));   // Logs
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 50));  // Footer Buttons
        Controls.Add(mainLayout);

        // 1. Header Panel
        var headerPanel = new Panel { Dock = DockStyle.Fill };
        var titleLabel = new Label
        {
            Text = "Remote Control Suite",
            Font = new Font("Segoe UI", 16, FontStyle.Bold),
            ForeColor = Color.FromArgb(56, 189, 248), // sky-400
            AutoSize = true,
            Location = new Point(0, 4)
        };
        _statusLabel = new Label
        {
            Text = $"● ACTIVE ON PORT {_options.Port}",
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            ForeColor = Color.FromArgb(52, 211, 153), // emerald-400
            AutoSize = true,
            Location = new Point(0, 36)
        };
        headerPanel.Controls.Add(titleLabel);
        headerPanel.Controls.Add(_statusLabel);
        mainLayout.Controls.Add(headerPanel, 0, 0);

        // 2. Info Card (Local Access URL & Quick Actions)
        var infoCard = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(30, 41, 59), // slate-800
            Padding = new Padding(12)
        };
        var urlTitle = new Label
        {
            Text = "iPhone Safari URL (Same Wi-Fi):",
            Font = new Font("Segoe UI", 9, FontStyle.Bold),
            ForeColor = Color.FromArgb(148, 163, 184),
            Location = new Point(12, 10),
            AutoSize = true
        };
        infoCard.Controls.Add(urlTitle);

        var ips = SystemInfoHelper.GetLocalIpAddresses();
        var primaryIp = ips.FirstOrDefault() ?? "127.0.0.1";
        var accessUrl = $"http://{primaryIp}:{_options.Port}";

        _urlTextBox = new TextBox
        {
            Text = accessUrl,
            ReadOnly = true,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(244, 63, 94), // rose-400
            Font = new Font("Consolas", 10.5f, FontStyle.Bold),
            Location = new Point(12, 34),
            Width = 360
        };
        infoCard.Controls.Add(_urlTextBox);

        var copyBtn = new Button
        {
            Text = "Copy URL",
            Location = new Point(382, 32),
            Size = new Size(90, 30),
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        copyBtn.Click += (s, e) =>
        {
            Clipboard.SetText(accessUrl);
            MessageBox.Show("URL copied to clipboard! Paste it into Safari on your iPhone.", "Copied", MessageBoxButtons.OK, MessageBoxIcon.Information);
        };
        infoCard.Controls.Add(copyBtn);

        var openBrowserBtn = new Button
        {
            Text = "Open in Browser",
            Location = new Point(480, 32),
            Size = new Size(130, 30),
            BackColor = Color.FromArgb(14, 165, 233),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        openBrowserBtn.Click += (s, e) =>
        {
            Process.Start(new ProcessStartInfo { FileName = $"http://localhost:{_options.Port}", UseShellExecute = true });
        };
        infoCard.Controls.Add(openBrowserBtn);

        var hintLabel = new Label
        {
            Text = $"PC Name: {Environment.MachineName} | Local IPs: {string.Join(", ", ips)}",
            Font = new Font("Segoe UI", 8.5f),
            ForeColor = Color.FromArgb(100, 116, 139),
            Location = new Point(12, 70),
            AutoSize = true
        };
        infoCard.Controls.Add(hintLabel);

        var startupCheck = new CheckBox
        {
            Text = "Start with Windows",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8.5f),
            Location = new Point(480, 68),
            AutoSize = true,
            Checked = IsStartWithWindowsEnabled()
        };
        startupCheck.CheckedChanged += (s, e) =>
        {
            SetStartWithWindows(startupCheck.Checked);
        };
        infoCard.Controls.Add(startupCheck);

        mainLayout.Controls.Add(infoCard, 0, 1);

        // 3. Connected Clients Group
        var clientsGroup = new GroupBox
        {
            Text = "Connected Devices",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(148, 163, 184),
            Padding = new Padding(8)
        };
        _clientsCountLabel = new Label
        {
            Text = "Connected Clients: 0",
            Dock = DockStyle.Top,
            ForeColor = Color.FromArgb(248, 250, 252),
            Height = 24
        };
        _clientsListBox = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(52, 211, 153),
            Font = new Font("Consolas", 9.5f),
            BorderStyle = BorderStyle.FixedSingle
        };
        clientsGroup.Controls.Add(_clientsListBox);
        clientsGroup.Controls.Add(_clientsCountLabel);
        mainLayout.Controls.Add(clientsGroup, 0, 2);

        // 4. Live Activity Log Group
        var logsGroup = new GroupBox
        {
            Text = "Real-Time Activity Log",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(148, 163, 184),
            Padding = new Padding(8)
        };
        _logListBox = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Consolas", 9f),
            BorderStyle = BorderStyle.FixedSingle
        };
        logsGroup.Controls.Add(_logListBox);
        mainLayout.Controls.Add(logsGroup, 0, 3);

        // 5. Footer Buttons
        var footerPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 8, 0, 0)
        };
        var exitBtn = new Button
        {
            Text = "Exit Agent",
            Size = new Size(110, 34),
            BackColor = Color.FromArgb(225, 29, 72),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        exitBtn.Click += (s, e) => Close();

        var minimizeBtn = new Button
        {
            Text = "Minimize to Tray",
            Size = new Size(140, 34),
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        minimizeBtn.Click += (s, e) =>
        {
            Hide();
            _notifyIcon.ShowBalloonTip(2000, "Remote Suite", "Running in System Tray. Double-click icon to open.", ToolTipIcon.Info);
        };

        footerPanel.Controls.Add(exitBtn);
        footerPanel.Controls.Add(minimizeBtn);
        mainLayout.Controls.Add(footerPanel, 0, 4);

        // Form Closing Behavior
        FormClosing += (s, e) =>
        {
            _lifetime.StopApplication();
        };
    }

    private void SetupTrayIcon()
    {
        _trayContextMenu = new ContextMenuStrip();
        var openItem = new ToolStripMenuItem("Open Dashboard", null, (s, e) => ShowAndRestore());
        var browserItem = new ToolStripMenuItem("Open Web Client", null, (s, e) =>
        {
            Process.Start(new ProcessStartInfo { FileName = $"http://localhost:{_options.Port}", UseShellExecute = true });
        });
        var exitItem = new ToolStripMenuItem("Exit", null, (s, e) => Close());

        _trayContextMenu.Items.Add(openItem);
        _trayContextMenu.Items.Add(browserItem);
        _trayContextMenu.Items.Add(new ToolStripSeparator());
        _trayContextMenu.Items.Add(exitItem);

        _notifyIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = $"Remote Suite - Port {_options.Port}",
            ContextMenuStrip = _trayContextMenu,
            Visible = true
        };

        _notifyIcon.DoubleClick += (s, e) => ShowAndRestore();
    }

    public void ShowAndRestore()
    {
        Show();
        WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    public void AddLog(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => AddLog(message)));
            return;
        }

        var entry = $"[{DateTime.Now:HH:mm:ss}] {message}";
        _logListBox.Items.Insert(0, entry);
        if (_logListBox.Items.Count > 100)
        {
            _logListBox.Items.RemoveAt(_logListBox.Items.Count - 1);
        }
    }

    private void OnActiveConnectionsChanged(int count)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => OnActiveConnectionsChanged(count)));
            return;
        }

        _clientsCountLabel.Text = $"Connected Clients: {count}";
        _notifyIcon.Text = $"Remote Suite - {count} client(s) connected";

        _clientsListBox.Items.Clear();
        if (count == 0)
        {
            _clientsListBox.Items.Add("No active connections (Waiting for iPhone...)");
        }
        else
        {
            _clientsListBox.Items.Add($"● iPhone / Web Client Connected ({DateTime.Now:HH:mm:ss})");
        }

        AddLog($"Client connection status updated. Active clients: {count}");
    }

    private const string StartupRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string AppName = "RemoteControlSuite";

    private static bool IsStartWithWindowsEnabled()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(StartupRegistryKey, false);
            return key?.GetValue(AppName) != null;
        }
        catch
        {
            return false;
        }
    }

    private static void SetStartWithWindows(bool enable)
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(StartupRegistryKey, true);
            if (key == null) return;

            if (enable)
            {
                var exePath = Environment.ProcessPath;
                if (!string.IsNullOrEmpty(exePath))
                {
                    key.SetValue(AppName, $"\"{exePath}\"");
                }
            }
            else
            {
                key.DeleteValue(AppName, false);
            }
        }
        catch
        {
            // Ignore or log error
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _wsManager.ActiveConnectionsChanged -= OnActiveConnectionsChanged;
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _trayContextMenu.Dispose();
        }
        base.Dispose(disposing);
    }
}

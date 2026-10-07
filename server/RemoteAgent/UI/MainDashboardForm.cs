using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Options;
using RemoteAgent.Configuration;
using RemoteAgent.Core;
using RemoteAgent.Network;
using RemoteAgent.Security;

namespace RemoteAgent.UI;

public class MainDashboardForm : Form
{
    private readonly AgentOptions _options;
    private readonly AgentWebSocketManager _wsManager;
    private readonly PairingManager _pairingManager;
    private readonly IHostApplicationLifetime _lifetime;

    private NotifyIcon _notifyIcon = null!;
    private ContextMenuStrip _trayContextMenu = null!;
    private Label _statusLabel = null!;
    private Label _clientsCountLabel = null!;
    private ListBox _clientsListBox = null!;
    private ListBox _pairedListBox = null!;
    private ListBox _logListBox = null!;
    private TextBox _urlTextBox = null!;
    private Label _pinLabel = null!;

    private readonly bool _startInTray;
    private bool _allowVisible = true;
    private bool _isExplicitExit = false;

    public MainDashboardForm(
        IOptions<AgentOptions> options,
        AgentWebSocketManager wsManager,
        PairingManager pairingManager,
        IHostApplicationLifetime lifetime,
        bool startInTray = false)
    {
        _options = options.Value;
        _wsManager = wsManager;
        _pairingManager = pairingManager;
        _lifetime = lifetime;
        _startInTray = startInTray;
        _allowVisible = !startInTray;

        InitializeComponent();
        SetupTrayIcon();

        _wsManager.ActiveConnectionsChanged += OnActiveConnectionsChanged;
        _pairingManager.PairingStateChanged += OnPairingStateChanged;

        UpdatePairingDisplay();
        AddLog($"Agent started on port {_options.Port}. Ready for secure connections.");

        if (_startInTray)
        {
            WindowState = FormWindowState.Minimized;
            ShowInTaskbar = false;
        }
    }

    protected override void SetVisibleCore(bool value)
    {
        if (!_allowVisible && !IsHandleCreated)
        {
            value = false;
            CreateHandle();
        }
        base.SetVisibleCore(value);
    }

    private void InitializeComponent()
    {
        Text = "Remote Control Suite - Windows Host";
        Size = new Size(740, 640);
        MinimumSize = new Size(700, 580);
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
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));  // Header
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 130)); // Info Card (URL + PIN)
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 40));   // Devices (Connected + Paired)
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 60));   // Logs
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Absolute, 45));  // Footer Buttons
        Controls.Add(mainLayout);

        // 1. Header Panel
        var headerPanel = new Panel { Dock = DockStyle.Fill };
        var titleLabel = new Label
        {
            Text = "Remote Control Suite",
            Font = new Font("Segoe UI", 15, FontStyle.Bold),
            ForeColor = Color.FromArgb(56, 189, 248), // sky-400
            AutoSize = true,
            Location = new Point(0, 2)
        };
        _statusLabel = new Label
        {
            Text = $"● SECURED LAN HOST • PORT {_options.Port}",
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(52, 211, 153), // emerald-400
            AutoSize = true,
            Location = new Point(0, 32)
        };
        headerPanel.Controls.Add(titleLabel);
        headerPanel.Controls.Add(_statusLabel);
        mainLayout.Controls.Add(headerPanel, 0, 0);

        // 2. Info Card (URL + Pairing Code)
        var infoCard = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(30, 41, 59), // slate-800
            Padding = new Padding(12)
        };

        var ips = SystemInfoHelper.GetLocalIpAddresses();
        var primaryIp = ips.FirstOrDefault() ?? "127.0.0.1";
        var accessUrl = $"http://{primaryIp}:{_options.Port}";

        var urlTitle = new Label
        {
            Text = "iPhone Safari URL (Same Wi-Fi):",
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(148, 163, 184),
            Location = new Point(12, 8),
            AutoSize = true
        };
        infoCard.Controls.Add(urlTitle);

        _urlTextBox = new TextBox
        {
            Text = accessUrl,
            ReadOnly = true,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(244, 63, 94), // rose-400
            Font = new Font("Consolas", 10f, FontStyle.Bold),
            Location = new Point(12, 28),
            Width = 260
        };
        infoCard.Controls.Add(_urlTextBox);

        var copyBtn = new Button
        {
            Text = "Copy URL",
            Location = new Point(278, 27),
            Size = new Size(80, 26),
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        copyBtn.Click += (s, e) =>
        {
            Clipboard.SetText(accessUrl);
            MessageBox.Show("URL copied to clipboard! Open Safari on your iPhone.", "Copied", MessageBoxButtons.OK, MessageBoxIcon.Information);
        };
        infoCard.Controls.Add(copyBtn);

        // Pairing PIN Code Banner
        var pinTitle = new Label
        {
            Text = "Pairing PIN (Enter on iPhone):",
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold),
            ForeColor = Color.FromArgb(148, 163, 184),
            Location = new Point(375, 8),
            AutoSize = true
        };
        infoCard.Controls.Add(pinTitle);

        _pinLabel = new Label
        {
            Text = FormatPin(_pairingManager.CurrentPairingCode),
            Font = new Font("Consolas", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(250, 204, 21), // amber-400
            BackColor = Color.FromArgb(15, 23, 42),
            Location = new Point(375, 26),
            Size = new Size(130, 28),
            TextAlign = ContentAlignment.MiddleCenter,
            BorderStyle = BorderStyle.FixedSingle
        };
        infoCard.Controls.Add(_pinLabel);

        var newPinBtn = new Button
        {
            Text = "New PIN",
            Location = new Point(512, 27),
            Size = new Size(80, 26),
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        newPinBtn.Click += (s, e) =>
        {
            _pairingManager.GenerateNewPairingCode();
            AddLog("New pairing PIN generated by user.");
        };
        infoCard.Controls.Add(newPinBtn);

        var hintLabel = new Label
        {
            Text = $"PC: {Environment.MachineName} • IPs: {string.Join(", ", ips)}",
            Font = new Font("Segoe UI", 8f),
            ForeColor = Color.FromArgb(100, 116, 139),
            Location = new Point(12, 60),
            AutoSize = true
        };
        infoCard.Controls.Add(hintLabel);

        var startupCheck = new CheckBox
        {
            Text = "Start with Windows",
            ForeColor = Color.FromArgb(148, 163, 184),
            Font = new Font("Segoe UI", 8f),
            Location = new Point(12, 95),
            AutoSize = true,
            Checked = IsStartWithWindowsEnabled()
        };
        startupCheck.CheckedChanged += (s, e) => SetStartWithWindows(startupCheck.Checked);
        infoCard.Controls.Add(startupCheck);

        var secInfo = new Label
        {
            Text = "🔒 Unauthenticated connections cannot send mouse, keyboard, power, or view screen.",
            ForeColor = Color.FromArgb(52, 211, 153),
            Font = new Font("Segoe UI", 8f),
            Location = new Point(160, 96),
            AutoSize = true
        };
        infoCard.Controls.Add(secInfo);

        mainLayout.Controls.Add(infoCard, 0, 1);

        // 3. Devices Container (Two columns: Connected Clients & Paired Devices)
        var devicesContainer = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 2,
            RowCount = 1,
            Padding = new Padding(0)
        };
        devicesContainer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        devicesContainer.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));

        // 3a. Active Clients
        var clientsGroup = new GroupBox
        {
            Text = "Active WebSocket Sessions",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(148, 163, 184),
            Padding = new Padding(6)
        };
        _clientsCountLabel = new Label
        {
            Text = "Connected: 0 (Auth: 0)",
            Dock = DockStyle.Top,
            ForeColor = Color.FromArgb(248, 250, 252),
            Height = 20,
            Font = new Font("Segoe UI", 8.5f, FontStyle.Bold)
        };
        _clientsListBox = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(52, 211, 153),
            Font = new Font("Consolas", 8.5f),
            BorderStyle = BorderStyle.FixedSingle
        };
        clientsGroup.Controls.Add(_clientsListBox);
        clientsGroup.Controls.Add(_clientsCountLabel);
        devicesContainer.Controls.Add(clientsGroup, 0, 0);

        // 3b. Paired Devices Storage
        var pairedGroup = new GroupBox
        {
            Text = "Paired Devices (Saved Cryptographic Credentials)",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(148, 163, 184),
            Padding = new Padding(6)
        };
        var pairedHeader = new Panel { Dock = DockStyle.Top, Height = 22 };
        var revokeBtn = new Button
        {
            Text = "Revoke Selected",
            Dock = DockStyle.Right,
            Width = 110,
            BackColor = Color.FromArgb(71, 85, 105),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Font = new Font("Segoe UI", 8f)
        };
        revokeBtn.Click += (s, e) =>
        {
            if (_pairedListBox.SelectedItem is string itemStr && itemStr.Contains("["))
            {
                int start = itemStr.IndexOf('[') + 1;
                int end = itemStr.IndexOf(']');
                if (start > 0 && end > start)
                {
                    string devId = itemStr[start..end];
                    _pairingManager.RevokeDevice(devId);
                    AddLog($"Device {devId} revoked by user.");
                }
            }
        };
        pairedHeader.Controls.Add(revokeBtn);

        _pairedListBox = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(56, 189, 248),
            Font = new Font("Consolas", 8.5f),
            BorderStyle = BorderStyle.FixedSingle
        };
        pairedGroup.Controls.Add(_pairedListBox);
        pairedGroup.Controls.Add(pairedHeader);
        devicesContainer.Controls.Add(pairedGroup, 1, 0);

        mainLayout.Controls.Add(devicesContainer, 0, 2);

        // 4. Activity Log Group
        var logsGroup = new GroupBox
        {
            Text = "Real-Time Activity & Security Log",
            Dock = DockStyle.Fill,
            ForeColor = Color.FromArgb(148, 163, 184),
            Padding = new Padding(6)
        };
        _logListBox = new ListBox
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(15, 23, 42),
            ForeColor = Color.FromArgb(203, 213, 225),
            Font = new Font("Consolas", 8.5f),
            BorderStyle = BorderStyle.FixedSingle
        };
        logsGroup.Controls.Add(_logListBox);
        mainLayout.Controls.Add(logsGroup, 0, 3);

        // 5. Footer Buttons
        var footerPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(0, 4, 0, 0)
        };
        var exitBtn = new Button
        {
            Text = "Exit Agent",
            Size = new Size(100, 30),
            BackColor = Color.FromArgb(225, 29, 72),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        exitBtn.Click += (s, e) => ExitApplication();

        var minimizeBtn = new Button
        {
            Text = "Minimize to Tray",
            Size = new Size(130, 30),
            BackColor = Color.FromArgb(51, 65, 85),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat
        };
        minimizeBtn.Click += (s, e) => MinimizeToTray();

        footerPanel.Controls.Add(exitBtn);
        footerPanel.Controls.Add(minimizeBtn);
        mainLayout.Controls.Add(footerPanel, 0, 4);

        // Standard Minimize (_) -> Minimize to Tray
        Resize += (s, e) =>
        {
            if (WindowState == FormWindowState.Minimized)
            {
                Hide();
            }
        };

        // Form Closing Behavior (Hide to tray on X, exit only on explicit quit)
        FormClosing += (s, e) =>
        {
            if (!_isExplicitExit && e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                MinimizeToTray();
                return;
            }

            _notifyIcon.Visible = false;
            _lifetime.StopApplication();
        };
    }

    private void SetupTrayIcon()
    {
        _trayContextMenu = new ContextMenuStrip();
        var openItem = new ToolStripMenuItem("Open Dashboard", null, (s, e) => ShowAndRestore());
        var pinItem = new ToolStripMenuItem($"Pairing PIN: {FormatPin(_pairingManager.CurrentPairingCode)}", null, (s, e) =>
        {
            Clipboard.SetText(_pairingManager.CurrentPairingCode);
            MessageBox.Show("Pairing PIN copied to clipboard!", "PIN Copied", MessageBoxButtons.OK, MessageBoxIcon.Information);
        });
        var exitItem = new ToolStripMenuItem("Exit", null, (s, e) => ExitApplication());

        _trayContextMenu.Items.Add(openItem);
        _trayContextMenu.Items.Add(pinItem);
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

    private static string FormatPin(string pin)
    {
        if (pin.Length == 6)
        {
            return $"{pin[..3]} {pin[3..]}";
        }
        return pin;
    }

    public void MinimizeToTray()
    {
        Hide();
    }

    public void ExitApplication()
    {
        _isExplicitExit = true;
        Close();
    }

    public void ShowAndRestore()
    {
        _allowVisible = true;
        ShowInTaskbar = true;
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

    private void UpdatePairingDisplay()
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(UpdatePairingDisplay));
            return;
        }

        _pinLabel.Text = FormatPin(_pairingManager.CurrentPairingCode);

        _pairedListBox.Items.Clear();
        var paired = _pairingManager.GetPairedDevices();
        if (paired.Count == 0)
        {
            _pairedListBox.Items.Add("No paired devices (Awaiting first pair...)");
        }
        else
        {
            foreach (var dev in paired)
            {
                _pairedListBox.Items.Add($"{dev.DeviceName} [{dev.DeviceId}] - {dev.LastUsedAt.ToLocalTime():g}");
            }
        }
    }

    private void OnPairingStateChanged()
    {
        UpdatePairingDisplay();
    }

    private void OnActiveConnectionsChanged(int count)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action(() => OnActiveConnectionsChanged(count)));
            return;
        }

        int authCount = _wsManager.AuthenticatedConnectionCount;
        _clientsCountLabel.Text = $"Connected: {count} (Authenticated: {authCount})";
        _notifyIcon.Text = $"Remote Suite - {count} client(s)";

        _clientsListBox.Items.Clear();
        if (count == 0)
        {
            _clientsListBox.Items.Add("No active connections (Waiting for iPhone...)");
        }
        else
        {
            _clientsListBox.Items.Add($"● Active WebSocket Client ({DateTime.Now:HH:mm:ss})");
        }

        AddLog($"Connection state changed. Active: {count}, Authenticated: {authCount}");
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
                    key.SetValue(AppName, $"\"{exePath}\" --tray");
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
            _pairingManager.PairingStateChanged -= OnPairingStateChanged;
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _trayContextMenu.Dispose();
        }
        base.Dispose(disposing);
    }
}

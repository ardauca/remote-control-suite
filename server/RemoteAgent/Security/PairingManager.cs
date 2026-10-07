using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Logging;

namespace RemoteAgent.Security;

public class PairingManager
{
    private readonly ILogger<PairingManager> _logger;
    private readonly string _storagePath;
    private readonly object _stateLock = new();

    private string _currentPairingCode = string.Empty;
    private DateTime _pairingCodeCreatedAt = DateTime.MinValue;
    private readonly TimeSpan _pairingCodeExpiry = TimeSpan.FromHours(24);

    // IP Lockout: ClientIp -> (FailedCount, LockoutExpiry)
    private readonly ConcurrentDictionary<string, (int FailedCount, DateTime LockoutExpiry)> _ipAttempts = new();
    private const int MaxFailedAttempts = 5;
    private static readonly TimeSpan LockoutDuration = TimeSpan.FromMinutes(5);

    private readonly List<DevicePairing> _pairedDevices = new();

    public event Action? PairingStateChanged;

    public string CurrentPairingCode
    {
        get
        {
            lock (_stateLock)
            {
                if (string.IsNullOrEmpty(_currentPairingCode) || DateTime.UtcNow - _pairingCodeCreatedAt > _pairingCodeExpiry)
                {
                    GenerateNewPairingCodeInternal();
                }
                return _currentPairingCode;
            }
        }
    }

    public PairingManager(ILogger<PairingManager> logger)
    {
        _logger = logger;
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "RemoteControlSuite");
        try
        {
            Directory.CreateDirectory(dir);
        }
        catch
        {
            dir = AppContext.BaseDirectory;
        }
        _storagePath = Path.Combine(dir, "pairings.json");

        LoadPairings();
        GenerateNewPairingCode();
    }

    public void GenerateNewPairingCode()
    {
        lock (_stateLock)
        {
            GenerateNewPairingCodeInternal();
        }
        PairingStateChanged?.Invoke();
    }

    private void GenerateNewPairingCodeInternal()
    {
        // Cryptographically secure 6-digit numeric code
        int code = RandomNumberGenerator.GetInt32(100000, 1000000);
        _currentPairingCode = code.ToString();
        _pairingCodeCreatedAt = DateTime.UtcNow;
        _logger.LogInformation("New secure pairing code generated: {Pin}", _currentPairingCode);
    }

    public bool VerifyPairingCode(
        string pin,
        string clientIp,
        string deviceName,
        out string? generatedToken,
        out string? errorMessage,
        out DevicePairing? pairing)
    {
        generatedToken = null;
        errorMessage = null;
        pairing = null;

        var now = DateTime.UtcNow;

        // 1. Check IP Lockout
        if (_ipAttempts.TryGetValue(clientIp, out var attempt))
        {
            if (now < attempt.LockoutExpiry)
            {
                var remaining = (int)Math.Ceiling((attempt.LockoutExpiry - now).TotalSeconds);
                errorMessage = $"Too many failed pairing attempts. Try again in {remaining} seconds.";
                _logger.LogWarning("Pairing attempt blocked by rate limit from IP: {Ip}", clientIp);
                return false;
            }
        }

        // 2. Validate PIN (Timing-safe comparison on extracted digits)
        bool pinValid = false;
        lock (_stateLock)
        {
            if (!string.IsNullOrEmpty(_currentPairingCode))
            {
                var expectedDigits = new string(_currentPairingCode.Where(char.IsDigit).ToArray());
                var providedDigits = new string((pin ?? string.Empty).Where(char.IsDigit).ToArray());
                if (expectedDigits.Length == 6 && providedDigits.Length == 6)
                {
                    byte[] expectedBytes = Encoding.UTF8.GetBytes(expectedDigits);
                    byte[] providedBytes = Encoding.UTF8.GetBytes(providedDigits);
                    pinValid = CryptographicOperations.FixedTimeEquals(expectedBytes, providedBytes);
                }
            }
        }

        if (!pinValid)
        {
            int currentFailures = 1;
            _ipAttempts.AddOrUpdate(
                clientIp,
                (1, DateTime.MinValue),
                (_, prev) =>
                {
                    int next = prev.FailedCount + 1;
                    DateTime lockout = next >= MaxFailedAttempts ? now.Add(LockoutDuration) : DateTime.MinValue;
                    currentFailures = next;
                    return (next, lockout);
                });

            if (currentFailures >= MaxFailedAttempts)
            {
                errorMessage = "Too many failed pairing attempts. IP address temporarily locked out.";
                _logger.LogWarning("IP {Ip} locked out after {Count} failed pairing attempts.", clientIp, currentFailures);
            }
            else
            {
                errorMessage = $"Invalid pairing code. ({MaxFailedAttempts - currentFailures} attempts remaining)";
                _logger.LogWarning("Failed pairing attempt from IP {Ip}. Attempt {Count}/{Max}", clientIp, currentFailures, MaxFailedAttempts);
            }

            return false;
        }

        // 3. Pairing Successful: Reset lockout for this IP
        _ipAttempts.TryRemove(clientIp, out _);

        // Generate cryptographically secure random session token (32 bytes = 256 bits entropy)
        byte[] tokenBytes = RandomNumberGenerator.GetBytes(32);
        string token = Convert.ToHexString(tokenBytes).ToLowerInvariant();
        string tokenHash = ComputeSha256Hash(token);

        string deviceId = Guid.NewGuid().ToString("N");
        var safeDeviceName = string.IsNullOrWhiteSpace(deviceName) ? "iPhone Safari" : deviceName.Trim();
        if (safeDeviceName.Length > 50) safeDeviceName = safeDeviceName[..50];

        var newDevice = new DevicePairing
        {
            DeviceId = deviceId,
            DeviceName = safeDeviceName,
            TokenHash = tokenHash,
            CreatedAt = now,
            LastUsedAt = now,
            Capabilities = new List<string>(SecurityCapabilities.All)
        };

        lock (_stateLock)
        {
            _pairedDevices.Add(newDevice);
            SavePairingsInternal();
            // Automatically regenerate code so the code is one-time use
            GenerateNewPairingCodeInternal();
        }

        _logger.LogInformation("Successfully paired new device: {DeviceName} (ID: {DeviceId}) from IP: {Ip}",
            newDevice.DeviceName, newDevice.DeviceId, clientIp);

        generatedToken = token;
        pairing = newDevice;
        PairingStateChanged?.Invoke();
        return true;
    }

    public bool ValidateToken(string? token, out DevicePairing? device)
    {
        device = null;
        if (string.IsNullOrWhiteSpace(token)) return false;

        string hash = ComputeSha256Hash(token.Trim());
        byte[] hashBytes = Encoding.UTF8.GetBytes(hash);

        lock (_stateLock)
        {
            foreach (var p in _pairedDevices)
            {
                byte[] storedBytes = Encoding.UTF8.GetBytes(p.TokenHash);
                if (storedBytes.Length == hashBytes.Length &&
                    CryptographicOperations.FixedTimeEquals(storedBytes, hashBytes))
                {
                    p.LastUsedAt = DateTime.UtcNow;
                    device = p;
                    return true;
                }
            }
        }

        return false;
    }

    public IReadOnlyList<DevicePairing> GetPairedDevices()
    {
        lock (_stateLock)
        {
            return _pairedDevices.Select(p => new DevicePairing
            {
                DeviceId = p.DeviceId,
                DeviceName = p.DeviceName,
                TokenHash = string.Empty, // Never expose hash to callers
                CreatedAt = p.CreatedAt,
                LastUsedAt = p.LastUsedAt,
                Capabilities = new List<string>(p.Capabilities)
            }).ToList();
        }
    }

    public bool RevokeDevice(string deviceId)
    {
        bool removed = false;
        lock (_stateLock)
        {
            int idx = _pairedDevices.FindIndex(d => d.DeviceId == deviceId);
            if (idx >= 0)
            {
                _pairedDevices.RemoveAt(idx);
                SavePairingsInternal();
                removed = true;
            }
        }

        if (removed)
        {
            _logger.LogInformation("Revoked paired device ID: {DeviceId}", deviceId);
            PairingStateChanged?.Invoke();
        }
        return removed;
    }

    public void RevokeAllDevices()
    {
        lock (_stateLock)
        {
            _pairedDevices.Clear();
            SavePairingsInternal();
            GenerateNewPairingCodeInternal();
        }
        _logger.LogInformation("All paired devices revoked.");
        PairingStateChanged?.Invoke();
    }

    private void LoadPairings()
    {
        lock (_stateLock)
        {
            try
            {
                if (File.Exists(_storagePath))
                {
                    string json = File.ReadAllText(_storagePath);
                    var list = JsonSerializer.Deserialize<List<DevicePairing>>(json);
                    if (list != null)
                    {
                        _pairedDevices.Clear();
                        _pairedDevices.AddRange(list);
                        _logger.LogInformation("Loaded {Count} paired devices from storage.", _pairedDevices.Count);
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to load paired devices from {Path}", _storagePath);
            }
        }
    }

    private void SavePairingsInternal()
    {
        try
        {
            string tempFile = _storagePath + ".tmp";
            string json = JsonSerializer.Serialize(_pairedDevices, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(tempFile, json);
            File.Move(tempFile, _storagePath, overwrite: true);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to save paired devices to {Path}", _storagePath);
        }
    }

    private static string ComputeSha256Hash(string input)
    {
        byte[] bytes = SHA256.HashData(Encoding.UTF8.GetBytes(input));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }
}

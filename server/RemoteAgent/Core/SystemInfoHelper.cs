using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace RemoteAgent.Core;

public static class SystemInfoHelper
{
    public static string GetOsDescription()
    {
        return $"{RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})";
    }

    public static List<string> GetLocalIpAddresses()
    {
        var ips = new List<string>();
        try
        {
            foreach (var netInterface in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (netInterface.OperationalStatus != OperationalStatus.Up ||
                    netInterface.NetworkInterfaceType == NetworkInterfaceType.Loopback)
                {
                    continue;
                }

                var ipProps = netInterface.GetIPProperties();
                foreach (var addr in ipProps.UnicastAddresses)
                {
                    if (addr.Address.AddressFamily == AddressFamily.InterNetwork)
                    {
                        var ipStr = addr.Address.ToString();
                        if (!ipStr.StartsWith("127.") && !ips.Contains(ipStr))
                        {
                            ips.Add(ipStr);
                        }
                    }
                }
            }
        }
        catch
        {
            // Fallback
        }

        if (ips.Count == 0)
        {
            ips.Add("127.0.0.1");
        }

        return ips;
    }

    public static List<string> GetCapabilities()
    {
        return new List<string>
        {
            "system.status",
            "system.heartbeat",
            "mouse.control",
            "keyboard.control",
            "media.control",
            "volume.control",
            "power.control"
        };
    }
}

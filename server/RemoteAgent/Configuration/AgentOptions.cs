namespace RemoteAgent.Configuration;

public class AgentOptions
{
    public const string SectionName = "Agent";

    public string ServerName { get; set; } = Environment.MachineName;
    public int Port { get; set; } = 52520;
    public string AllowOrigin { get; set; } = "*";
    public bool EnableDiscovery { get; set; } = true;
    public int HeartbeatIntervalSeconds { get; set; } = 5;
    public string AuthToken { get; set; } = string.Empty;
}

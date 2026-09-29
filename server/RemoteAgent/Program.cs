using System.Net;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using RemoteAgent.Configuration;
using RemoteAgent.Core;
using RemoteAgent.Network;
using RemoteAgent.Platform.Input;
using RemoteAgent.UI;

namespace RemoteAgent;

public static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        try
        {
            return RunApp(args);
        }
        catch (Exception ex)
        {
            File.WriteAllText("crash.log", ex.ToString());
            return 1;
        }
    }

    private static int RunApp(string[] args)
    {
        var builder = WebApplication.CreateBuilder(args);

        // 1. Configuration
        builder.Services.Configure<AgentOptions>(builder.Configuration.GetSection(AgentOptions.SectionName));
        var agentOptions = builder.Configuration.GetSection(AgentOptions.SectionName).Get<AgentOptions>() ?? new AgentOptions();

        // 2. Logging
        builder.Logging.ClearProviders();
        builder.Logging.AddConsole();
        builder.Logging.AddDebug();

        // 3. Kestrel Configuration
        builder.WebHost.ConfigureKestrel(options =>
        {
            options.Listen(IPAddress.Any, agentOptions.Port);
        });

        // 4. Register Services
        builder.Services.AddSingleton<IInputSimulator, WindowsInputSimulator>();
        builder.Services.AddSingleton<Platform.Audio.IAudioManager, Platform.Audio.WindowsAudioManager>();
        builder.Services.AddSingleton<Platform.Media.IMediaManager, Platform.Media.WindowsMediaManager>();
        builder.Services.AddSingleton<AgentWebSocketManager>();
        builder.Services.AddCors(options =>
        {
            options.AddDefaultPolicy(policy =>
            {
                policy.AllowAnyOrigin()
                      .AllowAnyHeader()
                      .AllowAnyMethod();
            });
        });

        var app = builder.Build();
        var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("RemoteAgent.Program");
        var appLifetime = app.Services.GetRequiredService<IHostApplicationLifetime>();
        var wsManager = app.Services.GetRequiredService<AgentWebSocketManager>();
        var optionsSnapshot = app.Services.GetRequiredService<IOptions<AgentOptions>>();

        logger.LogInformation("=================================================");
        logger.LogInformation(" Remote Control Suite - Windows Agent v1.0.0");
        logger.LogInformation(" Machine: {MachineName}, OS: {OS}", Environment.MachineName, SystemInfoHelper.GetOsDescription());
        logger.LogInformation(" Listening on port: {Port}", agentOptions.Port);
        logger.LogInformation("=================================================");

        // 5. Middleware Pipeline
        app.UseCors();

        var webSocketOptions = new WebSocketOptions
        {
            KeepAliveInterval = TimeSpan.FromSeconds(agentOptions.HeartbeatIntervalSeconds)
        };
        app.UseWebSockets(webSocketOptions);

        // Client static files support (serves client PWA if built)
        var candidatePaths = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "wwwroot"),
            Path.Combine(Directory.GetCurrentDirectory(), "wwwroot"),
            Path.Combine(Directory.GetCurrentDirectory(), "server", "RemoteAgent", "wwwroot")
        };
        var clientDistPath = candidatePaths.FirstOrDefault(Directory.Exists) ?? candidatePaths[0];

        if (Directory.Exists(clientDistPath))
        {
            app.UseDefaultFiles(new DefaultFilesOptions
            {
                FileProvider = new PhysicalFileProvider(clientDistPath)
            });
            app.UseStaticFiles(new StaticFileOptions
            {
                FileProvider = new PhysicalFileProvider(clientDistPath)
            });
        }

        // 6. Route Handlers
        // Health endpoint
        app.MapGet("/api/health", () =>
        {
            var ips = SystemInfoHelper.GetLocalIpAddresses();
            return Results.Ok(new
            {
                status = "ok",
                timestamp = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                serverName = agentOptions.ServerName,
                version = "1.0.0",
                os = SystemInfoHelper.GetOsDescription(),
                activeConnections = wsManager.ActiveConnectionCount,
                localIps = ips,
                port = agentOptions.Port
            });
        });

        // WebSocket endpoint
        app.Map("/ws", async context =>
        {
            if (context.WebSockets.IsWebSocketRequest)
            {
                using var webSocket = await context.WebSockets.AcceptWebSocketAsync();
                await wsManager.HandleConnectionAsync(context, webSocket);
            }
            else
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("WebSocket connection expected at /ws");
            }
        });

        // Fallback root handler when client is not yet built to wwwroot
        app.MapFallback(async context =>
        {
            var indexPath = Path.Combine(clientDistPath, "index.html");
            if (File.Exists(indexPath))
            {
                context.Response.ContentType = "text/html";
                await context.Response.SendFileAsync(indexPath);
                return;
            }

            var ips = SystemInfoHelper.GetLocalIpAddresses();
            var ipListHtml = string.Join("", ips.Select(ip => $"<li><code>http://{ip}:{agentOptions.Port}</code></li>"));

            context.Response.ContentType = "text/html; charset=utf-8";
            await context.Response.WriteAsync($$"""
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Remote Control Suite - Agent Running</title>
                <style>
                    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 600px; margin: 0 auto; }
                    .card { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; }
                    h1 { font-size: 1.5rem; margin-top: 0; color: #38bdf8; }
                    .badge { background: #10b981; color: white; padding: 4px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; }
                    code { background: #0f172a; padding: 2px 6px; border-radius: 4px; color: #f43f5e; }
                    ul { line-height: 1.8; }
                </style>
            </head>
            <body>
                <div class="card">
                    <h1>Remote Control Suite <span class="badge">AGENT RUNNING</span></h1>
                    <p>The Windows Agent is active and listening for iPhone client connections.</p>
                    <p><strong>Port:</strong> {{agentOptions.Port}}</p>
                    <p><strong>WebSocket Endpoint:</strong> <code>ws://&lt;IP&gt;:{{agentOptions.Port}}/ws</code></p>
                    <p><strong>Health Check:</strong> <a href="/api/health" style="color: #38bdf8;">/api/health</a></p>
                    <p><strong>Local Addresses:</strong></p>
                    <ul>{{ipListHtml}}</ul>
                </div>
            </body>
            </html>
            """);
        });

        // 7. Initialize Windows Forms Application & Dashboard
        ApplicationConfiguration.Initialize();
        var mainForm = new MainDashboardForm(optionsSnapshot, wsManager, appLifetime);

        // Start Kestrel in background
        _ = Task.Run(async () =>
        {
            try
            {
                await app.StartAsync();
                var localIps = SystemInfoHelper.GetLocalIpAddresses();
                foreach (var ip in localIps)
                {
                    logger.LogInformation("Agent reachable at: http://{Ip}:{Port}", ip, agentOptions.Port);
                }
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Error starting Kestrel Web Host.");
            }
        });

        // Run UI Event Loop on Main Thread
        Application.Run(mainForm);

        // Graceful stop when Form is closed
        try
        {
            app.StopAsync().GetAwaiter().GetResult();
        }
        catch
        {
            // Ignore during termination
        }

        logger.LogInformation("RemoteAgent exited cleanly.");
        return 0;
    }
}

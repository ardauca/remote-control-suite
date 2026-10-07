using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;

namespace RemoteAgent.Platform.Screen;

public class GdiScreenCaptureEngine : IScreenCaptureEngine
{
    private readonly ILogger<GdiScreenCaptureEngine> _logger;
    private static readonly ImageCodecInfo? JpegEncoder = GetEncoder(ImageFormat.Jpeg);

    #region Win32 Native Cursor Detection
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CURSORINFO
    {
        public int cbSize;
        public int flags;
        public IntPtr hCursor;
        public POINT ptScreenPos;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetCursorInfo(out CURSORINFO pci);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr hDesktop);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr hDesktop);

    private const int CURSOR_SHOWING = 0x00000001;
    private const uint DESKTOP_ALL_ACCESS = 0x01FF;
    #endregion

    public GdiScreenCaptureEngine(ILogger<GdiScreenCaptureEngine> logger)
    {
        _logger = logger;
    }

    public List<ScreenMonitorInfo> GetMonitors()
    {
        var result = new List<ScreenMonitorInfo>();
        try
        {
            var screens = System.Windows.Forms.Screen.AllScreens;
            for (int i = 0; i < screens.Length; i++)
            {
                var s = screens[i];
                result.Add(new ScreenMonitorInfo
                {
                    Index = i,
                    DeviceName = s.DeviceName,
                    Width = s.Bounds.Width,
                    Height = s.Bounds.Height,
                    IsPrimary = s.Primary
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to enumerate screens");
        }
        return result;
    }

    public CapturedFrame? CaptureFrame(int monitorIndex, float scale, int jpegQuality, uint sequenceNumber)
    {
        var sw = Stopwatch.StartNew();

        IntPtr hInputDesk = OpenInputDesktop(0, false, DESKTOP_ALL_ACCESS);
        if (hInputDesk != IntPtr.Zero)
        {
            SetThreadDesktop(hInputDesk);
        }

        try
        {
            var screens = System.Windows.Forms.Screen.AllScreens;
            if (screens.Length == 0) return null;

            var targetScreen = (monitorIndex >= 0 && monitorIndex < screens.Length)
                ? screens[monitorIndex]
                : System.Windows.Forms.Screen.PrimaryScreen ?? screens[0];

            int nativeWidth = targetScreen.Bounds.Width;
            int nativeHeight = targetScreen.Bounds.Height;
            if (nativeWidth <= 0 || nativeHeight <= 0) return null;

            // 1. Capture Desktop via GDI CopyFromScreen
            using var rawBmp = new Bitmap(nativeWidth, nativeHeight, PixelFormat.Format32bppRgb);
            using (var g = Graphics.FromImage(rawBmp))
            {
                g.CopyFromScreen(targetScreen.Bounds.Location, Point.Empty, targetScreen.Bounds.Size, CopyPixelOperation.SourceCopy);
            }

            // 2. Query Real-Time Cursor Position & Visibility (Metadata overlay)
            ushort normCursorX = 0;
            ushort normCursorY = 0;
            bool cursorVisible = false;

            var ci = new CURSORINFO { cbSize = Marshal.SizeOf(typeof(CURSORINFO)) };
            if (GetCursorInfo(out ci))
            {
                cursorVisible = (ci.flags & CURSOR_SHOWING) != 0;
                int relX = ci.ptScreenPos.x - targetScreen.Bounds.X;
                int relY = ci.ptScreenPos.y - targetScreen.Bounds.Y;

                normCursorX = (ushort)Math.Clamp((relX * 65535.0) / nativeWidth, 0, 65535);
                normCursorY = (ushort)Math.Clamp((relY * 65535.0) / nativeHeight, 0, 65535);
            }

            // 3. Optional Scaling (e.g. 720p or 540p for mobile data saving)
            Bitmap bitmapToEncode = rawBmp;
            Bitmap? scaledBmp = null;

            scale = Math.Clamp(scale, 0.25f, 1.0f);
            if (scale < 0.98f)
            {
                int targetW = (int)(nativeWidth * scale) & ~1; // Keep even dimensions
                int targetH = (int)(nativeHeight * scale) & ~1;

                if (targetW > 0 && targetH > 0)
                {
                    scaledBmp = new Bitmap(targetW, targetH, PixelFormat.Format32bppRgb);
                    using (var sg = Graphics.FromImage(scaledBmp))
                    {
                        sg.InterpolationMode = InterpolationMode.Bilinear;
                        sg.CompositingQuality = CompositingQuality.HighSpeed;
                        sg.SmoothingMode = SmoothingMode.HighSpeed;
                        sg.DrawImage(rawBmp, 0, 0, targetW, targetH);
                    }
                    bitmapToEncode = scaledBmp;
                }
            }

            sw.Stop();
            long captureDuration = sw.ElapsedMilliseconds;

            // 4. Encode to JPEG with configurable Quality
            var encodeSw = Stopwatch.StartNew();
            using var ms = new MemoryStream();
            jpegQuality = Math.Clamp(jpegQuality, 10, 100);

            if (JpegEncoder != null)
            {
                using var encoderParams = new EncoderParameters(1);
                using var qualityParam = new EncoderParameter(Encoder.Quality, (long)jpegQuality);
                encoderParams.Param[0] = qualityParam;
                bitmapToEncode.Save(ms, JpegEncoder, encoderParams);
            }
            else
            {
                bitmapToEncode.Save(ms, ImageFormat.Jpeg);
            }

            scaledBmp?.Dispose();
            encodeSw.Stop();
            long encodeDuration = encodeSw.ElapsedMilliseconds;

            var data = ms.ToArray();
            return new CapturedFrame
            {
                SequenceNumber = sequenceNumber,
                Data = data,
                DataLength = data.Length,
                DesktopWidth = nativeWidth,
                DesktopHeight = nativeHeight,
                NormalizedCursorX = normCursorX,
                NormalizedCursorY = normCursorY,
                CursorVisible = cursorVisible,
                CaptureDurationMs = captureDuration,
                EncodeDurationMs = encodeDuration,
                TimestampUtc = DateTime.UtcNow
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Screen capture failed for monitor {MonitorIndex}", monitorIndex);
            return null;
        }
        finally
        {
            if (hInputDesk != IntPtr.Zero)
            {
                CloseDesktop(hInputDesk);
            }
        }
    }

    private static ImageCodecInfo? GetEncoder(ImageFormat format)
    {
        return ImageCodecInfo.GetImageDecoders().FirstOrDefault(codec => codec.FormatID == format.Guid);
    }

    public void Dispose()
    {
        // No unmanaged resources requiring explicit cleanup
    }
}

using System.Collections.Concurrent;

namespace RemoteAgent.Security;

public class ConnectionRateLimiter
{
    private class TokenBucket
    {
        private readonly double _capacity;
        private readonly double _refillPerSecond;
        private double _tokens;
        private long _lastRefillTicks;
        private readonly object _lock = new();

        public TokenBucket(double capacity, double refillPerSecond)
        {
            _capacity = capacity;
            _refillPerSecond = refillPerSecond;
            _tokens = capacity;
            _lastRefillTicks = Environment.TickCount64;
        }

        public bool TryConsume(double count = 1.0)
        {
            lock (_lock)
            {
                long now = Environment.TickCount64;
                double elapsedSec = (now - _lastRefillTicks) / 1000.0;
                if (elapsedSec > 0)
                {
                    _tokens = Math.Min(_capacity, _tokens + (elapsedSec * _refillPerSecond));
                    _lastRefillTicks = now;
                }

                if (_tokens >= count)
                {
                    _tokens -= count;
                    return true;
                }

                return false;
            }
        }
    }

    // Different buckets for different operation tiers:
    // Tier 1: Mouse movement (high frequency, burst 360, refill 360/sec for ProMotion 120Hz displays)
    private readonly TokenBucket _moveBucket = new(capacity: 360, refillPerSecond: 360);

    // Tier 2: Clicks and keyboard key down/up (burst 60, refill 40/sec)
    private readonly TokenBucket _inputEventBucket = new(capacity: 60, refillPerSecond: 40);

    // Tier 3: Text injection & shortcuts (burst 15, refill 10/sec)
    private readonly TokenBucket _textBucket = new(capacity: 15, refillPerSecond: 10);

    // Tier 4: Sensitive power & system commands (burst 2, refill 0.4/sec -> 1 per 2.5s)
    private readonly TokenBucket _powerBucket = new(capacity: 2, refillPerSecond: 0.4);

    // Tier 5: Screen stream start/snapshot requests (burst 5, refill 4/sec)
    private readonly TokenBucket _screenReqBucket = new(capacity: 5, refillPerSecond: 4);

    public bool CheckAllowed(string action, out string? reason)
    {
        reason = null;

        if (action.Equals("mouse.move", StringComparison.OrdinalIgnoreCase))
        {
            if (!_moveBucket.TryConsume())
            {
                reason = "Mouse movement rate limit exceeded (max 360/s)";
                return false;
            }
            return true;
        }

        if (action.StartsWith("mouse.click", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("mouse.down", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("mouse.up", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("mouse.scroll", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("keyboard.keyDown", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("keyboard.keyUp", StringComparison.OrdinalIgnoreCase))
        {
            if (!_inputEventBucket.TryConsume())
            {
                reason = "Input event rate limit exceeded (max 60/s)";
                return false;
            }
            return true;
        }

        if (action.StartsWith("keyboard.text", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("keyboard.shortcut", StringComparison.OrdinalIgnoreCase))
        {
            if (!_textBucket.TryConsume())
            {
                reason = "Text / shortcut rate limit exceeded (max 10/s)";
                return false;
            }
            return true;
        }

        if (action.StartsWith("power.", StringComparison.OrdinalIgnoreCase) ||
            action.Equals("system.launchApp", StringComparison.OrdinalIgnoreCase))
        {
            if (!_powerBucket.TryConsume())
            {
                reason = "Power command rate limit exceeded (max 2 per 5s)";
                return false;
            }
            return true;
        }

        if (action.StartsWith("screen.start", StringComparison.OrdinalIgnoreCase) ||
            action.StartsWith("screen.snapshot", StringComparison.OrdinalIgnoreCase))
        {
            if (!_screenReqBucket.TryConsume())
            {
                reason = "Screen stream request rate limit exceeded (max 4/s)";
                return false;
            }
            return true;
        }

        return true;
    }
}

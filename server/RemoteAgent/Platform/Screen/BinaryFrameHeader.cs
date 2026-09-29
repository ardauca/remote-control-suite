using System.Buffers.Binary;

namespace RemoteAgent.Platform.Screen;

/// <summary>
/// 16-Byte Extensible Binary Frame Header Specification v1:
/// 
/// Byte 0: Magic Byte (0x53 = 'S')
/// Byte 1: Protocol Version (0x01)
/// Byte 2: Codec Type (0x01 = JPEG, 0x02 = WebP, 0x03 = H.264 NAL, 0x04 = AV1)
/// Byte 3: Flags:
///         Bit 0: Cursor Visible (1 = visible, 0 = hidden)
///         Bit 1: Is Keyframe (1 = keyframe, 0 = delta)
///         Bit 7: Has Extension Header (Reserved for future 8-byte metadata)
/// Bytes 4-7: Sequence Number (uint32, Big-Endian)
/// Bytes 8-9: Desktop Native Width (uint16, Big-Endian)
/// Bytes 10-11: Desktop Native Height (uint16, Big-Endian)
/// Bytes 12-13: Normalized Cursor X (uint16, Big-Endian, 0-65535)
/// Bytes 14-15: Normalized Cursor Y (uint16, Big-Endian, 0-65535)
/// 
/// Followed immediately by raw compressed frame bytes (JPEG).
/// </summary>
public static class BinaryFrameHeader
{
    public const int HeaderSize = 16;
    public const byte MagicByte = 0x53; // 'S'
    public const byte Version1 = 0x01;
    public const byte CodecJpeg = 0x01;

    public static byte[] Pack(CapturedFrame frame)
    {
        var packet = new byte[HeaderSize + frame.DataLength];
        var span = packet.AsSpan();

        // 0..3
        span[0] = MagicByte;
        span[1] = Version1;
        span[2] = CodecJpeg;

        byte flags = 0;
        if (frame.CursorVisible) flags |= 0x01;
        flags |= 0x02; // Always keyframe for JPEG
        span[3] = flags;

        // 4..7: Sequence Number (Big-Endian)
        BinaryPrimitives.WriteUInt32BigEndian(span.Slice(4, 4), frame.SequenceNumber);

        // 8..11: Desktop Dimensions
        BinaryPrimitives.WriteUInt16BigEndian(span.Slice(8, 2), (ushort)frame.DesktopWidth);
        BinaryPrimitives.WriteUInt16BigEndian(span.Slice(10, 2), (ushort)frame.DesktopHeight);

        // 12..15: Normalized Cursor Position (0 - 65535)
        BinaryPrimitives.WriteUInt16BigEndian(span.Slice(12, 2), frame.NormalizedCursorX);
        BinaryPrimitives.WriteUInt16BigEndian(span.Slice(14, 2), frame.NormalizedCursorY);

        // Payload
        frame.Data.AsSpan(0, frame.DataLength).CopyTo(span.Slice(HeaderSize));

        return packet;
    }
}

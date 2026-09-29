import { DecodedBinaryFrame } from '../../protocol/protocolTypes';

const HEADER_SIZE = 16;
const MAGIC_BYTE = 0x53; // 'S'

export function decodeBinaryFrame(buffer: ArrayBuffer): DecodedBinaryFrame | null {
  if (buffer.byteLength <= HEADER_SIZE) return null;

  const view = new DataView(buffer);
  const magic = view.getUint8(0);
  if (magic !== MAGIC_BYTE) return null;

  const version = view.getUint8(1);
  if (version !== 1) return null;

  const flags = view.getUint8(3);
  const cursorVisible = (flags & 0x01) !== 0;

  const sequenceNumber = view.getUint32(4, false); // Big-Endian
  const desktopWidth = view.getUint16(8, false);
  const desktopHeight = view.getUint16(10, false);
  const rawCursorX = view.getUint16(12, false);
  const rawCursorY = view.getUint16(14, false);

  const normCursorX = rawCursorX / 65535.0;
  const normCursorY = rawCursorY / 65535.0;

  // Extract payload bytes (JPEG)
  const jpegBytes = new Uint8Array(buffer, HEADER_SIZE);
  const imageBlob = new Blob([jpegBytes], { type: 'image/jpeg' });

  return {
    sequenceNumber,
    desktopWidth,
    desktopHeight,
    normCursorX,
    normCursorY,
    cursorVisible,
    imageBlob
  };
}

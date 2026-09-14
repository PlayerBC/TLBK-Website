import { HttpError } from "./server.ts";

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function imageType(bytes: Uint8Array): { mime: string; extension: string } {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Choose an image of 5 MB or smaller.");
  const text = (start: number, end: number) => new TextDecoder().decode(bytes.subarray(start, end));
  if (bytes.length >= 33 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value) && text(12, 16) === "IHDR") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(8) === 13 && view.getUint32(16) > 0 && view.getUint32(20) > 0) {
      let offset = 8;
      let hasPixels = false;
      while (offset + 12 <= bytes.length) {
        const length = view.getUint32(offset);
        const chunk = text(offset + 4, offset + 8);
        if (offset + 12 + length > bytes.length) break;
        if (chunk === "IDAT" && length > 0) hasPixels = true;
        offset += 12 + length;
        if (chunk === "IEND") {
          if (length === 0 && hasPixels && offset === bytes.length) return { mime: "image/png", extension: "png" };
          break;
        }
      }
    }
  }
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) {
    // Walk marker lengths to require a scan, rather than accepting header-only bytes.
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 0) break;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length - 2) break;
      if (marker === 218 && offset + length < bytes.length - 2) return { mime: "image/jpeg", extension: "jpg" };
      offset += length;
    }
  }
  if (bytes.length >= 20 && text(0, 4) === "RIFF" && text(8, 12) === "WEBP" && ["VP8 ", "VP8L", "VP8X"].includes(text(12, 16))) {
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
    const chunkSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, true);
    if (size + 8 === bytes.length && chunkSize > 0 && chunkSize + 20 <= bytes.length) return { mime: "image/webp", extension: "webp" };
  }
  throw new HttpError(415, "The file contents must be a valid PNG, JPEG, or WebP image. PDF, SVG, GIF, and renamed files are not accepted.");
}

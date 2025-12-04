import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Image data extracted from AI SDK image parts.
 * Contains a data URL suitable for Codex CLI.
 */
export interface ImageData {
  /** Data URL in format: data:image/png;base64,... */
  data: string;
  /** MIME type of the image */
  mimeType?: string;
}

/**
 * AI SDK ImagePart structure.
 * Supports multiple input formats.
 */
export interface ImagePart {
  type: 'image';
  /** Primary image data - can be data URL, base64, Buffer, etc. */
  image?: string | URL | Buffer | ArrayBuffer | Uint8Array;
  /** MIME type hint */
  mimeType?: string;
  /** Legacy: base64 string */
  data?: string;
  /** Legacy: URL string */
  url?: string;
}

/**
 * Extract image data from an AI SDK image part.
 * Converts various input formats to a data URL string.
 *
 * @param part - AI SDK image part (accepts unknown for compatibility with different AI SDK versions)
 * @returns ImageData with data URL, or null if format is unsupported
 */
export function extractImageData(part: unknown): ImageData | null {
  if (typeof part !== 'object' || part === null) return null;

  const p = part as ImagePart;
  const mimeType = p.mimeType || 'image/png';

  // Case 1: Primary 'image' field is a string
  if (typeof p.image === 'string') {
    return extractFromString(p.image, mimeType);
  }

  // Case 2: URL object
  if (p.image instanceof URL) {
    // Only support data: URLs
    if (p.image.protocol === 'data:') {
      const dataUrlStr = p.image.toString();
      // Extract mime type from data URL if not explicitly provided
      const match = dataUrlStr.match(/^data:([^;,]+)/);
      const extractedMimeType = match?.[1] || mimeType;
      return { data: dataUrlStr, mimeType: extractedMimeType };
    }
    // HTTP/HTTPS URLs not supported
    return null;
  }

  // Case 3: Buffer
  if (Buffer.isBuffer(p.image)) {
    const base64 = p.image.toString('base64');
    return { data: `data:${mimeType};base64,${base64}`, mimeType };
  }

  // Case 4: ArrayBuffer or Uint8Array
  if (p.image instanceof ArrayBuffer || p.image instanceof Uint8Array) {
    const buffer = Buffer.from(p.image);
    const base64 = buffer.toString('base64');
    return { data: `data:${mimeType};base64,${base64}`, mimeType };
  }

  // Case 5: Legacy 'data' field (base64 string)
  if (typeof p.data === 'string') {
    return extractFromString(p.data, mimeType);
  }

  // Case 6: Legacy 'url' field
  if (typeof p.url === 'string') {
    return extractFromString(p.url, mimeType);
  }

  return null;
}

/**
 * Extract image data from a string value.
 * Handles data URLs, base64 strings, and rejects HTTP URLs.
 */
function extractFromString(value: string, fallbackMimeType: string): ImageData | null {
  const trimmed = value.trim();

  // HTTP/HTTPS URLs are not supported
  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  // Already a data URL
  if (trimmed.startsWith('data:')) {
    // Reject non-base64 data URLs (e.g., data:image/svg+xml,<svg...>)
    // These cannot be decoded by writeImageToTempFile
    if (!trimmed.includes(';base64,')) {
      return null;
    }
    // Extract mime type from data URL if present
    const match = trimmed.match(/^data:([^;,]+)/);
    const mimeType = match?.[1] || fallbackMimeType;
    return { data: trimmed, mimeType };
  }

  // Raw base64 string - wrap in data URL
  return {
    data: `data:${fallbackMimeType};base64,${trimmed}`,
    mimeType: fallbackMimeType,
  };
}

/**
 * Write image data to a temporary file.
 * Returns the path to the temp file.
 *
 * @param imageData - Image data with data URL
 * @returns Path to the temporary file
 * @throws Error if data URL format is invalid
 */
export function writeImageToTempFile(imageData: ImageData): string {
  const dir = mkdtempSync(join(tmpdir(), 'codex-img-'));
  const ext = getExtensionFromMimeType(imageData.mimeType);
  const filePath = join(dir, `image.${ext}`);

  // Extract base64 data from data URL
  const base64Match = imageData.data.match(/^data:[^;]+;base64,(.+)$/);
  if (!base64Match) {
    throw new Error('Invalid data URL format: expected data:[type];base64,[data]');
  }

  const buffer = Buffer.from(base64Match[1], 'base64');
  writeFileSync(filePath, buffer);

  return filePath;
}

/**
 * Clean up temporary image files.
 * Best-effort cleanup - errors are silently ignored.
 *
 * @param paths - Array of file paths to clean up
 */
export function cleanupTempImages(paths: string[]): void {
  for (const filePath of paths) {
    try {
      rmSync(filePath, { force: true });
      // Also try to remove parent temp directory
      const dir = filePath.replace(/[/\\][^/\\]+$/, '');
      if (dir.includes('codex-img-')) {
        rmSync(dir, { force: true, recursive: true });
      }
    } catch {
      // Best effort cleanup - ignore errors
    }
  }
}

/**
 * Get file extension from MIME type.
 */
function getExtensionFromMimeType(mimeType?: string): string {
  if (!mimeType) return 'png';

  const mapping: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };

  return mapping[mimeType.toLowerCase()] || mimeType.split('/')[1] || 'png';
}

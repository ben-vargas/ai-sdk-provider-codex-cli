import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SharedV4FileData } from '@ai-sdk/provider';
import { detectMediaType, getTopLevelMediaType, isFullMediaType } from '@ai-sdk/provider-utils';

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
 * AI SDK file part structure used for binary/image inputs.
 * `data` accepts both the v4 tagged union and legacy untagged values.
 */
export interface FilePart {
  type: 'file';
  data?: string | URL | Buffer | ArrayBuffer | Uint8Array | SharedV4FileData;
  mediaType?: string;
  url?: string;
}

/**
 * Narrow a value to the v4 tagged file-data union
 * ({ type: 'data' | 'url' | 'reference' | 'text', ... }).
 */
function isTaggedFileData(value: unknown): value is SharedV4FileData {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  return (
    value.type === 'data' ||
    value.type === 'url' ||
    value.type === 'reference' ||
    value.type === 'text'
  );
}

/**
 * Resolve a full image MIME type from a declared media type that may be a
 * top-level segment (e.g. `image`) or a wildcard (e.g. `image/*`), sniffing
 * the data when possible.
 */
function resolveImageMimeType(declaredType: string, data: unknown): string {
  if (isFullMediaType(declaredType)) return declaredType;

  const bytes =
    typeof data === 'string' || data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : undefined;

  if (bytes !== undefined) {
    const detected = detectMediaType({
      data: bytes,
      topLevelType: getTopLevelMediaType(declaredType),
    });
    if (detected) return detected;
  }

  return 'image/png';
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

  const p = part as ImagePart | FilePart;
  const isFilePart = p.type === 'file';
  const declaredType = isFilePart ? p.mediaType || 'image/png' : p.mimeType || 'image/png';

  if (isFilePart && getTopLevelMediaType(declaredType).toLowerCase() !== 'image') {
    return null;
  }

  let primaryInput = isFilePart ? p.data : p.image;

  // Unwrap AI SDK v4 tagged file data.
  if (isTaggedFileData(primaryInput)) {
    if (primaryInput.type === 'data') {
      primaryInput = primaryInput.data;
    } else if (primaryInput.type === 'url') {
      primaryInput = primaryInput.url;
    } else {
      // 'reference' and 'text' file data carry no image bytes.
      return null;
    }
  }

  const mimeType = resolveImageMimeType(declaredType, primaryInput);

  // Case 1: Primary image/file field is a string
  if (typeof primaryInput === 'string') {
    return extractFromString(primaryInput, mimeType);
  }

  // Case 2: URL object
  if (typeof primaryInput === 'object' && primaryInput !== null && primaryInput instanceof URL) {
    // Only support data: URLs
    if (primaryInput.protocol === 'data:') {
      const dataUrlStr = primaryInput.toString();
      return extractFromString(dataUrlStr, mimeType);
    }
    // file/http/https URL sources are not supported.
    return null;
  }

  // Case 3: Buffer
  if (Buffer.isBuffer(primaryInput)) {
    const base64 = primaryInput.toString('base64');
    return { data: `data:${mimeType};base64,${base64}`, mimeType };
  }

  // Case 4: ArrayBuffer or Uint8Array
  if (isBinaryInput(primaryInput)) {
    const buffer = Buffer.from(primaryInput);
    const base64 = buffer.toString('base64');
    return { data: `data:${mimeType};base64,${base64}`, mimeType };
  }

  if (isFilePart && typeof p.url === 'string') {
    return extractFromString(p.url, mimeType);
  }

  // Case 5: Legacy 'data' field (base64 string)
  if (!isFilePart && typeof p.data === 'string') {
    return extractFromString(p.data, mimeType);
  }

  // Case 6: Legacy 'url' field
  if (!isFilePart && typeof p.url === 'string') {
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

  // Local file reads are intentionally not supported for security hardening.
  if (/^file:\/\//i.test(trimmed)) {
    return null;
  }

  // HTTP/HTTPS URLs are not supported
  if (/^https?:\/\//i.test(trimmed)) {
    return null;
  }

  // Already a data URL
  if (trimmed.startsWith('data:')) {
    const match = trimmed.match(/^data:([^;,]+);base64,([^,]+)$/);
    if (!match) {
      return null;
    }
    const payload = normalizeBase64Payload(match[2] ?? '');
    if (!payload) {
      return null;
    }
    const mimeType = match[1] || fallbackMimeType;
    return { data: `data:${mimeType};base64,${payload}`, mimeType };
  }

  const payload = normalizeBase64Payload(trimmed);
  if (!payload) {
    return null;
  }

  // Raw base64 string - wrap in data URL.
  return {
    data: `data:${fallbackMimeType};base64,${payload}`,
    mimeType: fallbackMimeType,
  };
}

function isBinaryInput(value: unknown): value is ArrayBuffer | Uint8Array {
  if (value instanceof ArrayBuffer) {
    return true;
  }

  return value instanceof Uint8Array;
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

  const payload = normalizeBase64Payload(base64Match[1] ?? '');
  if (!payload) {
    throw new Error('Invalid base64 image payload');
  }

  const buffer = Buffer.from(payload, 'base64');
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

function normalizeBase64Payload(value: string): string | null {
  const compact = value.replace(/\s+/g, '');
  if (!compact) return null;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) return null;
  if (compact.length % 4 === 1) return null;

  const padded = compact.padEnd(Math.ceil(compact.length / 4) * 4, '=');
  try {
    const normalized = Buffer.from(padded, 'base64').toString('base64');
    if (normalized !== padded) return null;
    return padded;
  } catch {
    return null;
  }
}

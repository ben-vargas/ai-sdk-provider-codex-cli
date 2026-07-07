import { describe, expect, it } from 'vitest';
import { toImageReference } from '../converters/image-converter.js';

describe('image-converter', () => {
  it('maps file part with tagged binary data to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'data', data: Uint8Array.from([0x89, 0x50]) },
    } as never);

    expect(result).toBeDefined();
    expect(result?.kind).toBe('local');
    if (result?.kind === 'local') {
      expect(result.image.data.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('maps file part with tagged base64 string data to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/jpeg',
      data: { type: 'data', data: 'AAAA' },
    } as never);

    expect(result).toEqual({
      kind: 'local',
      image: { data: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' },
    });
  });

  it('maps file part with tagged HTTP URL to remote image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'url', url: new URL('https://example.com/cat.png') },
    } as never);

    expect(result).toEqual({ kind: 'remote', url: 'https://example.com/cat.png' });
  });

  it('maps file part with tagged data: URL to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/jpeg',
      data: { type: 'url', url: new URL('data:image/jpeg;base64,AAAA') },
    } as never);

    expect(result).toEqual({
      kind: 'local',
      image: { data: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' },
    });
  });

  it('rejects tagged file:// URLs', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'url', url: new URL('file:///tmp/image.png') },
    } as never);

    expect(result).toEqual({
      kind: 'unsupported',
      warning: 'file:// image URLs are not supported.',
    });
  });

  it('returns unsupported for tagged reference file data', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'reference', reference: { openai: 'file-123' } },
    } as never);

    expect(result).toEqual({
      kind: 'unsupported',
      warning: 'File reference data is not supported for images.',
    });
  });

  it('returns unsupported for tagged inline text file data', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: { type: 'text', text: 'not an image' },
    } as never);

    expect(result).toEqual({
      kind: 'unsupported',
      warning: 'Inline text file data is not supported for images.',
    });
  });

  it('resolves top-level segment mediaType by sniffing tagged image bytes', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image',
      data: { type: 'data', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]) },
    } as never);

    expect(result?.kind).toBe('local');
    if (result?.kind === 'local') {
      expect(result.image.mimeType).toBe('image/png');
      expect(result.image.data.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('maps legacy untagged Buffer file data to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: Buffer.from([0x89, 0x50]),
    } as never);

    expect(result?.kind).toBe('local');
    if (result?.kind === 'local') {
      expect(result.image.data.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('maps legacy untagged ArrayBuffer file data to local image reference', () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: bytes.buffer,
    } as never);

    expect(result?.kind).toBe('local');
    if (result?.kind === 'local') {
      expect(result.image.data.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('maps legacy untagged HTTP URL string to remote image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: 'https://example.com/cat.png',
    } as never);

    expect(result).toEqual({ kind: 'remote', url: 'https://example.com/cat.png' });
  });

  it('rejects legacy untagged file:// URL strings', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: 'file:///tmp/image.png',
    } as never);

    expect(result).toEqual({
      kind: 'unsupported',
      warning: 'file:// image URLs are not supported.',
    });
  });

  it('maps compat image part URL to remote image reference', () => {
    const result = toImageReference({
      type: 'image',
      url: 'https://example.com/compat.png',
    } as never);

    expect(result).toEqual({ kind: 'remote', url: 'https://example.com/compat.png' });
  });

  it('maps compat image part data URL to local image reference', () => {
    const result = toImageReference({
      type: 'image',
      data: 'data:image/png;base64,BBBB',
      mimeType: 'image/png',
    } as never);

    expect(result).toEqual({
      kind: 'local',
      image: { data: 'data:image/png;base64,BBBB', mimeType: 'image/png' },
    });
  });

  it('returns unsupported for non-image media types', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'application/pdf',
      data: { type: 'url', url: new URL('https://example.com/file.pdf') },
    } as never);

    expect(result?.kind).toBe('unsupported');
  });
});

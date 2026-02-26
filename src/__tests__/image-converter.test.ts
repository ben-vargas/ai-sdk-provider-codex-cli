import { describe, expect, it } from 'vitest';
import { toImageReference } from '../converters/image-converter.js';

describe('image-converter', () => {
  it('maps file part with binary data to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: Buffer.from([0x89, 0x50]),
    } as never);

    expect(result).toBeDefined();
    expect(result?.kind).toBe('local');
    if (result?.kind === 'local') {
      expect(result.image.data.startsWith('data:image/png;base64,')).toBe(true);
    }
  });

  it('maps file part with HTTP URL to remote image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: 'https://example.com/cat.png',
    } as never);

    expect(result).toEqual({ kind: 'remote', url: 'https://example.com/cat.png' });
  });

  it('maps file part with data URL string to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/jpeg',
      data: 'data:image/jpeg;base64,AAAA',
    } as never);

    expect(result).toEqual({
      kind: 'local',
      image: { data: 'data:image/jpeg;base64,AAAA', mimeType: 'image/jpeg' },
    });
  });

  it('maps file part with ArrayBuffer to local image reference', () => {
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

  it('maps file part with Uint8Array to local image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/webp',
      data: Uint8Array.from([0x52, 0x49, 0x46, 0x46]),
    } as never);

    expect(result?.kind).toBe('local');
    if (result?.kind === 'local') {
      expect(result.image.data.startsWith('data:image/webp;base64,')).toBe(true);
    }
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

  it('maps file part URL object with https protocol to remote image reference', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'image/png',
      data: new URL('https://example.com/url-object.png'),
    } as never);

    expect(result).toEqual({ kind: 'remote', url: 'https://example.com/url-object.png' });
  });

  it('rejects file:// URL sources', () => {
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

  it('returns unsupported for non-image media types', () => {
    const result = toImageReference({
      type: 'file',
      mediaType: 'application/pdf',
      data: 'https://example.com/file.pdf',
    } as never);

    expect(result?.kind).toBe('unsupported');
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
  extractImageData,
  writeImageToTempFile,
  cleanupTempImages,
  type ImagePart,
} from '../image-utils.js';

describe('extractImageData', () => {
  describe('data URL strings', () => {
    it('handles data URL string', () => {
      const part: ImagePart = {
        type: 'image',
        image: 'data:image/png;base64,iVBORw0KGgo=',
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(result?.mimeType).toBe('image/png');
    });

    it('extracts mime type from data URL', () => {
      const part: ImagePart = {
        type: 'image',
        image: 'data:image/jpeg;base64,/9j/4AAQ',
      };
      const result = extractImageData(part);
      expect(result?.mimeType).toBe('image/jpeg');
    });
  });

  describe('base64 strings', () => {
    it('handles base64 string without data URL prefix', () => {
      const part: ImagePart = {
        type: 'image',
        image: 'iVBORw0KGgo=',
        mimeType: 'image/png',
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(result?.mimeType).toBe('image/png');
    });

    it('uses default mime type when not provided', () => {
      const part: ImagePart = {
        type: 'image',
        image: 'iVBORw0KGgo=',
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
      expect(result?.mimeType).toBe('image/png');
    });
  });

  describe('Buffer input', () => {
    it('handles Buffer', () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
      const part: ImagePart = {
        type: 'image',
        image: buffer,
        mimeType: 'image/png',
      };
      const result = extractImageData(part);
      expect(result?.data).toMatch(/^data:image\/png;base64,/);
      expect(result?.mimeType).toBe('image/png');
    });
  });

  describe('Uint8Array input', () => {
    it('handles Uint8Array', () => {
      const arr = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const part: ImagePart = {
        type: 'image',
        image: arr,
        mimeType: 'image/png',
      };
      const result = extractImageData(part);
      expect(result?.data).toMatch(/^data:image\/png;base64,/);
      expect(result?.mimeType).toBe('image/png');
    });
  });

  describe('ArrayBuffer input', () => {
    it('handles ArrayBuffer', () => {
      const buffer = new ArrayBuffer(4);
      const view = new Uint8Array(buffer);
      view.set([0x89, 0x50, 0x4e, 0x47]);

      const part: ImagePart = {
        type: 'image',
        image: buffer,
        mimeType: 'image/png',
      };
      const result = extractImageData(part);
      expect(result?.data).toMatch(/^data:image\/png;base64,/);
    });
  });

  describe('URL object', () => {
    it('handles data: URL object', () => {
      const url = new URL('data:image/png;base64,iVBORw0KGgo=');
      const part: ImagePart = {
        type: 'image',
        image: url,
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('extracts mime type from data: URL object when not explicitly provided', () => {
      const url = new URL('data:image/jpeg;base64,/9j/4AAQ');
      const part: ImagePart = {
        type: 'image',
        image: url,
        // Note: mimeType not provided - should extract from data URL
      };
      const result = extractImageData(part);
      expect(result?.mimeType).toBe('image/jpeg');
      expect(result?.data).toBe('data:image/jpeg;base64,/9j/4AAQ');
    });

    it('returns null for http URL object', () => {
      const url = new URL('https://example.com/image.png');
      const part: ImagePart = {
        type: 'image',
        image: url,
      };
      const result = extractImageData(part);
      expect(result).toBeNull();
    });
  });

  describe('legacy data field', () => {
    it('handles legacy data field with base64', () => {
      const part: ImagePart = {
        type: 'image',
        data: 'iVBORw0KGgo=',
        mimeType: 'image/jpeg',
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/jpeg;base64,iVBORw0KGgo=');
    });

    it('handles legacy data field with data URL', () => {
      const part: ImagePart = {
        type: 'image',
        data: 'data:image/png;base64,iVBORw0KGgo=',
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
    });
  });

  describe('legacy url field', () => {
    it('handles legacy url field with data URL', () => {
      const part: ImagePart = {
        type: 'image',
        url: 'data:image/png;base64,iVBORw0KGgo=',
      };
      const result = extractImageData(part);
      expect(result?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('returns null for legacy url field with http URL', () => {
      const part: ImagePart = {
        type: 'image',
        url: 'https://example.com/image.png',
      };
      const result = extractImageData(part);
      expect(result).toBeNull();
    });
  });

  describe('unsupported formats', () => {
    it('returns null for http URL string', () => {
      const part: ImagePart = {
        type: 'image',
        image: 'https://example.com/image.png',
      };
      const result = extractImageData(part);
      expect(result).toBeNull();
    });

    it('returns null for non-base64 data URL', () => {
      const part: ImagePart = {
        type: 'image',
        image: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      };
      const result = extractImageData(part);
      expect(result).toBeNull();
    });

    it('returns null for empty part', () => {
      const part: ImagePart = {
        type: 'image',
      };
      const result = extractImageData(part);
      expect(result).toBeNull();
    });
  });
});

describe('writeImageToTempFile', () => {
  const tempPaths: string[] = [];

  afterEach(() => {
    cleanupTempImages(tempPaths);
    tempPaths.length = 0;
  });

  it('writes image to temp file', () => {
    const imageData = {
      data: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
    };

    const tempPath = writeImageToTempFile(imageData);
    tempPaths.push(tempPath);

    expect(existsSync(tempPath)).toBe(true);
    expect(tempPath).toMatch(/\.png$/);
    expect(tempPath).toContain('codex-img-');
  });

  it('uses correct extension for jpeg', () => {
    const imageData = {
      data: 'data:image/jpeg;base64,/9j/4AAQ',
      mimeType: 'image/jpeg',
    };

    const tempPath = writeImageToTempFile(imageData);
    tempPaths.push(tempPath);

    expect(tempPath).toMatch(/\.jpg$/);
  });

  it('writes correct binary content', () => {
    // Create a simple test with known bytes
    const testBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const base64 = testBytes.toString('base64');
    const imageData = {
      data: `data:image/png;base64,${base64}`,
      mimeType: 'image/png',
    };

    const tempPath = writeImageToTempFile(imageData);
    tempPaths.push(tempPath);

    const content = readFileSync(tempPath);
    expect(content).toEqual(testBytes);
  });

  it('throws on invalid data URL format', () => {
    const imageData = {
      data: 'not-a-data-url',
      mimeType: 'image/png',
    };

    expect(() => writeImageToTempFile(imageData)).toThrow('Invalid data URL format');
  });
});

describe('cleanupTempImages', () => {
  it('removes temp files and directories', () => {
    const imageData = {
      data: 'data:image/png;base64,iVBORw0KGgo=',
      mimeType: 'image/png',
    };

    const tempPath = writeImageToTempFile(imageData);
    expect(existsSync(tempPath)).toBe(true);

    cleanupTempImages([tempPath]);
    expect(existsSync(tempPath)).toBe(false);
  });

  it('handles non-existent paths gracefully', () => {
    // Should not throw
    cleanupTempImages(['/non/existent/path.png']);
  });

  it('handles empty array', () => {
    // Should not throw
    cleanupTempImages([]);
  });
});

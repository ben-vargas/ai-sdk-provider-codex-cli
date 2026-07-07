import { describe, expect, it } from 'vitest';
import { formatToolResultOutput } from '../converters/tool-result-converter.js';

describe('tool-result-converter', () => {
  it('formats standard output variants', () => {
    expect(formatToolResultOutput({ type: 'text', value: 'ok' } as never).text).toBe('ok');
    expect(formatToolResultOutput({ type: 'json', value: { a: 1 } } as never).text).toBe('{"a":1}');
    expect(
      formatToolResultOutput({ type: 'execution-denied', reason: 'policy denied' } as never).text,
    ).toContain('policy denied');
    expect(formatToolResultOutput({ type: 'error-text', value: 'boom' } as never).text).toContain(
      'boom',
    );
    expect(
      formatToolResultOutput({ type: 'error-json', value: { code: 400, detail: 'nope' } } as never)
        .text,
    ).toContain('{"code":400,"detail":"nope"}');
  });

  it('formats canonical file content parts for all tagged data variants', () => {
    const result = formatToolResultOutput({
      type: 'content',
      value: [
        { type: 'text', text: 'line 1' },
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'url', url: new URL('https://example.com/a.png') },
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          filename: 'doc.pdf',
          data: { type: 'data', data: 'abc=' },
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: { type: 'url', url: new URL('https://example.com/a.pdf') },
        },
        {
          type: 'file',
          mediaType: 'application/pdf',
          data: { type: 'reference', reference: { openai: 'file_123' } },
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'data', data: 'AAAA' },
        },
        {
          type: 'file',
          mediaType: 'image/png',
          data: { type: 'reference', reference: { openai: 'img_123' } },
        },
        {
          type: 'file',
          mediaType: 'text/plain',
          data: { type: 'text', text: 'inline document text' },
        },
      ],
    } as never);

    expect(result.text).toContain('line 1');
    expect(result.text).toContain('[image-url: https://example.com/a.png]');
    expect(result.text).toContain('[file-data: application/pdf, doc.pdf]');
    expect(result.text).toContain('[file-url: https://example.com/a.pdf]');
    expect(result.text).toContain('[file-id]');
    expect(result.text).toContain('[image-data: image/png]');
    expect(result.text).toContain('[image-file-id]');
    expect(result.text).toContain('inline document text');
    expect(result.warnings).toEqual([]);
  });

  it('classifies top-level segment mediaType as image', () => {
    const result = formatToolResultOutput({
      type: 'content',
      value: [
        {
          type: 'file',
          mediaType: 'image',
          data: { type: 'url', url: new URL('https://example.com/pic.bin') },
        },
      ],
    } as never);

    expect(result.text).toBe('[image-url: https://example.com/pic.bin]');
    expect(result.warnings).toEqual([]);
  });

  it('warns and skips custom content parts', () => {
    const result = formatToolResultOutput({
      type: 'content',
      value: [{ type: 'text', text: 'kept' }, { type: 'custom' }],
    } as never);

    expect(result.text).toBe('kept');
    expect(
      result.warnings.some(
        (warning) =>
          warning.type === 'unsupported' && warning.feature === 'tool-result.content.custom',
      ),
    ).toBe(true);
  });

  it('warns for unsupported content part type inside content output', () => {
    const result = formatToolResultOutput({
      type: 'content',
      value: [{ type: 'mystery-part' }],
    } as never);

    expect(result.text).toContain('[unsupported-tool-content-part]');
    expect(
      result.warnings.some(
        (warning) =>
          warning.type === 'unsupported' &&
          warning.details.includes('Unsupported tool content part'),
      ),
    ).toBe(true);
  });

  it('warns for unrecognized tagged file data inside content output', () => {
    const result = formatToolResultOutput({
      type: 'content',
      value: [{ type: 'file', mediaType: 'application/pdf', data: { type: 'mystery' } }],
    } as never);

    expect(result.text).toContain('[unsupported-tool-content-part]');
    expect(
      result.warnings.some(
        (warning) =>
          warning.type === 'unsupported' && warning.feature === 'tool-result.content.file',
      ),
    ).toBe(true);
  });

  it('returns warning for unsupported output type', () => {
    const result = formatToolResultOutput({ type: 'wat' } as never);
    expect(result.text).toBe('[unsupported-tool-result-output]');
    expect(result.warnings[0]).toMatchObject({
      type: 'unsupported',
    });
    expect(
      result.warnings[0]?.type === 'unsupported'
        ? result.warnings[0].details
        : '[unexpected-warning-type]',
    ).toContain('Unsupported tool result output type');
  });
});

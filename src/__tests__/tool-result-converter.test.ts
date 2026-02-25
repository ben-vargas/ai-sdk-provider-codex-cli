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

  it('formats content arrays with placeholders for all known content part variants', () => {
    const result = formatToolResultOutput({
      type: 'content',
      value: [
        { type: 'text', text: 'line 1' },
        { type: 'image-url', url: 'https://example.com/a.png' },
        { type: 'file-data', mediaType: 'application/pdf', data: 'abc' },
        { type: 'file-url', url: 'https://example.com/a.pdf' },
        { type: 'file-id', id: 'file_123' },
        { type: 'image-data', mediaType: 'image/png', data: 'AAAA' },
        { type: 'image-file-id', id: 'img_123' },
      ],
    } as never);

    expect(result.text).toContain('line 1');
    expect(result.text).toContain('[image-url: https://example.com/a.png]');
    expect(result.text).toContain('[file-data: application/pdf');
    expect(result.text).toContain('[file-url: https://example.com/a.pdf]');
    expect(result.text).toContain('[file-id]');
    expect(result.text).toContain('[image-data: image/png]');
    expect(result.text).toContain('[image-file-id]');
    expect(result.warnings).toEqual([]);
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

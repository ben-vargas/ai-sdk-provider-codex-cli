import { describe, it, expect } from 'vitest';
import { extractJson } from '../extract-json.js';

describe('extractJson', () => {
  it('returns full text if no JSON braces', () => {
    expect(extractJson('hello world')).toBe('hello world');
  });

  it('extracts first balanced JSON block', () => {
    const text = 'prefix {"a":1, "b": {"c": 2}} suffix {"d":3}';
    expect(extractJson(text)).toBe('{"a":1, "b": {"c": 2}}');
  });

  it('handles nested braces', () => {
    const text = '{"outer": {"inner": {"x": true}}} and more';
    expect(extractJson(text)).toBe('{"outer": {"inner": {"x": true}}}');
  });
});

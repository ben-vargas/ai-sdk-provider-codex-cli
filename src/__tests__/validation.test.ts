import { describe, it, expect } from 'vitest';
import { validateSettings } from '../validation.js';

describe('validateSettings', () => {
  it('accepts minimal settings', () => {
    const res = validateSettings({});
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it('warns when both autonomy flags are set', () => {
    const res = validateSettings({ fullAuto: true, dangerouslyBypassApprovalsAndSandbox: true });
    expect(res.valid).toBe(true);
    expect(res.warnings.length).toBeGreaterThan(0);
  });

  it('rejects invalid reasoningSummary value "none"', () => {
    const res = validateSettings({ reasoningEffort: 'high', reasoningSummary: 'none' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /reasoningSummary/i.test(e))).toBe(true);
  });

  it('rejects invalid reasoningSummary value "concise"', () => {
    const res = validateSettings({ reasoningEffort: 'high', reasoningSummary: 'concise' });
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => /reasoningSummary/i.test(e))).toBe(true);
  });
});

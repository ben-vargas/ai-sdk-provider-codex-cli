import { describe, it, expect } from 'vitest';
import { createCodexCli } from '../codex-cli-provider.js';

describe('createCodexCli', () => {
  it('creates a model with merged defaults', () => {
    const provider = createCodexCli({ defaultSettings: { skipGitRepoCheck: true } });
    const model: any = provider('gpt-5', { color: 'never' });
    expect(model.provider).toBe('codex-cli');
    expect(model.modelId).toBe('gpt-5');
  });

  it('exposes specification version v4 on provider and models', () => {
    const provider = createCodexCli();
    expect(provider.specificationVersion).toBe('v4');
    const model = provider('gpt-5');
    expect(model.specificationVersion).toBe('v4');
    expect(model.supportedUrls).toEqual({});
  });

  it('accepts addDirs in defaultSettings', () => {
    const provider = createCodexCli({
      defaultSettings: { addDirs: ['../shared', '/tmp/lib'] },
    });
    const model: any = provider('gpt-5');
    expect(model.provider).toBe('codex-cli');
    expect(model.modelId).toBe('gpt-5');
  });

  it('accepts addDirs in per-model settings', () => {
    const provider = createCodexCli();
    const model: any = provider('gpt-5', { addDirs: ['../shared'] });
    expect(model.provider).toBe('codex-cli');
    expect(model.modelId).toBe('gpt-5');
  });

  it('accepts outputLastMessageFile in settings', () => {
    const provider = createCodexCli();
    const model: any = provider('gpt-5', { outputLastMessageFile: '/tmp/last.txt' });
    expect(model.provider).toBe('codex-cli');
    expect(model.modelId).toBe('gpt-5');
  });
});

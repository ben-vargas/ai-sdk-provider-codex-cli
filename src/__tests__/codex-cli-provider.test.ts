import { describe, it, expect } from 'vitest';
import { createCodexCli } from '../codex-cli-provider.js';

describe('createCodexCli', () => {
  it('creates a model with merged defaults', () => {
    const provider = createCodexCli({ defaultSettings: { skipGitRepoCheck: true } });
    const model: any = provider('gpt-5', { color: 'never' });
    expect(model.provider).toBe('codex-cli');
    expect(model.modelId).toBe('gpt-5');
  });
});

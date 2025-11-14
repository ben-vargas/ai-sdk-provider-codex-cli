#!/usr/bin/env node

/**
 * Long Running Tasks with Abort (Codex CLI)
 */

import { generateText } from 'ai';
import { codexCli } from '../dist/index.js';

const model = codexCli('gpt-5.1', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const ac = new AbortController();
const timeout = setTimeout(() => ac.abort(new Error('Timeout after 10s')), 10_000);

try {
  const { text } = await generateText({
    model,
    prompt: 'Write a detailed 5-paragraph essay on scalable monorepo design.',
    abortSignal: ac.signal,
  });
  console.log('Result:', text.slice(0, 300) + '...');
} catch (err) {
  console.error('Aborted:', err?.message || String(err));
} finally {
  clearTimeout(timeout);
}

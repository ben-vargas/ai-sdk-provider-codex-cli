#!/usr/bin/env node

/**
 * Long Running Tasks with Abort (Codex CLI)
 */

import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.5', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

const ac = new AbortController();
let abortRequested = false;
const timeout = setTimeout(() => {
  abortRequested = true;
  ac.abort(new Error('Timeout after 10s'));
}, 10_000);

try {
  const { text } = await generateText({
    model,
    prompt: 'Write a detailed 5-paragraph essay on scalable monorepo design.',
    abortSignal: ac.signal,
  });
  const preview = text.trim();
  if (preview.length > 0) {
    console.log('Result:', preview.slice(0, 300) + (preview.length > 300 ? '...' : ''));
  } else if (abortRequested || ac.signal.aborted) {
    console.log('Aborted before text was returned.');
  } else {
    console.log('Result: <empty response>');
  }
} catch (err) {
  console.error('Aborted:', err?.message || String(err));
} finally {
  clearTimeout(timeout);
}

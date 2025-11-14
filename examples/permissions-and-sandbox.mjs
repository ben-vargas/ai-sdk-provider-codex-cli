#!/usr/bin/env node

/**
 * Permissions & Sandbox Modes (Codex CLI)
 *
 * Shows how to switch approval and sandbox policies. This example avoids
 * running any real commands; it just demonstrates configuration toggles.
 */

import { generateText } from 'ai';
import { codexCli } from '../dist/index.js';

async function run(label, settings) {
  const model = codexCli('gpt-5.1', {
    allowNpx: true,
    skipGitRepoCheck: true,
    color: 'never',
    ...settings,
  });
  const { text } = await generateText({ model, prompt: `Say the mode label: ${label}.` });
  console.log(`[${label}]`, text);
}

await run('on-failure + workspace-write', {
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
});
await run('full-auto', { fullAuto: true });
await run('dangerously-bypass', { dangerouslyBypassApprovalsAndSandbox: true });

console.log('Note: These modes affect how Codex would execute tools/commands if needed.');

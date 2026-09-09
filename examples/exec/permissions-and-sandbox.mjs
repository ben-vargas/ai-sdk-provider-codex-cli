#!/usr/bin/env node

/**
 * Permissions & Sandbox Modes (Codex CLI)
 *
 * Shows how to switch approval and sandbox policies. This example avoids
 * running any real commands; it just demonstrates configuration toggles.
 */

import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

async function run(label, settings) {
  const model = codexExec('gpt-6-astra', {
    allowNpx: true,
    skipGitRepoCheck: true,
    color: 'never',
    ...settings,
  });
  const { text } = await generateText({ model, prompt: `Say the mode label: ${label}.` });
  console.log(`[${label}]`, text);
}

await run('on-request + workspace-write', {
  approvalMode: 'on-request',
  sandboxMode: 'workspace-write',
});
await run('never + read-only', {
  approvalMode: 'never',
  sandboxMode: 'read-only',
});
// Deprecated: Codex CLI 0.147 removed `codex exec --full-auto`; the flag now
// simply means `sandboxMode: 'workspace-write'` (a deprecation warning is logged).
await run('full-auto (deprecated alias of workspace-write)', { fullAuto: true });
await run('dangerously-bypass', { dangerouslyBypassApprovalsAndSandbox: true });

console.log('Note: These modes affect how Codex would execute tools/commands if needed.');

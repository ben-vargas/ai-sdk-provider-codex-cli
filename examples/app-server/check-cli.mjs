#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function runCodex(args) {
  let result = run('codex', args);
  if (result.code !== 0) {
    result = run('npx', ['-y', '@openai/codex', ...args]);
  }
  return result;
}

console.log(' Checking Codex CLI install...');
const version = runCodex(['--version']);
if (version.code !== 0) {
  console.error(' Codex CLI not available.', version.stderr);
  process.exit(1);
}
console.log('  Codex CLI OK');
process.stdout.write(version.stdout);

console.log('\n Checking auth status...');
const auth = runCodex(['login', 'status']);
process.stdout.write(auth.stdout || auth.stderr || '');

console.log('\n Checking app-server subcommand...');
const help = runCodex(['app-server', '--help']);
if (help.code !== 0) {
  console.error(' app-server subcommand unavailable.', help.stderr);
  process.exit(1);
}
console.log('  app-server command available');

console.log('\n Running minimal app-server generation...');
const provider = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.105.0-alpha.0',
    idleTimeoutMs: 30000,
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  },
});

try {
  const { text } = await generateText({
    model: provider('gpt-5.3-codex'),
    prompt: 'Reply with exactly OK.',
  });
  console.log('  App-server generation OK');
  console.log(`Response: ${text.trim()}`);
} catch (error) {
  console.error(' App-server generation failed:', error);
  process.exitCode = 1;
} finally {
  await provider.close();
}

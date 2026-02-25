#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8' });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

console.log('🔍 Checking Codex CLI install...');
let result = run('codex', ['--version']);
if (result.code !== 0) {
  console.log('codex not found on PATH, trying npx @openai/codex');
  result = run('npx', ['-y', '@openai/codex', '--version']);
}

if (result.code === 0) {
  console.log('✔️  Codex CLI OK');
  process.stdout.write(result.stdout);
} else {
  console.error('❌ Codex CLI not available.', result.stderr);
  process.exit(1);
}

console.log('\n🔐 Checking auth status...');
let auth = run('codex', ['login', 'status']);
if (auth.code !== 0) {
  auth = run('npx', ['-y', '@openai/codex', 'login', 'status']);
}
process.stdout.write(auth.stdout || auth.stderr || '');

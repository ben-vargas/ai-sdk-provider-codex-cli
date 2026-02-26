#!/usr/bin/env node
/* global console, process */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');

const markdownFiles = [
  'README.md',
  'examples/README.md',
  'examples/exec/README.md',
  'examples/app-server/README.md',
  'docs/ai-sdk-v5/guide.md',
  'docs/ai-sdk-v5/configuration.md',
  'docs/ai-sdk-v5/troubleshooting.md',
  'docs/ai-sdk-v5/limitations.md',
  'docs/ai-sdk-v5/migration-app-server-v2.md',
].filter((file) => existsSync(join(repoRoot, file)));

const failures = [];

const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
const exampleCmdPattern = /\bnode\s+(examples\/[\w./-]+\.mjs)\b/g;

for (const relativePath of markdownFiles) {
  const fullPath = join(repoRoot, relativePath);
  const content = readFileSync(fullPath, 'utf8');

  for (const match of content.matchAll(linkPattern)) {
    const target = match[1];
    if (!target) continue;
    if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('#')) {
      continue;
    }

    const pathOnly = target.split('#')[0]?.split('?')[0] ?? '';
    if (pathOnly.length === 0) continue;

    const resolved = resolve(join(repoRoot, relativePath, '..'), pathOnly);
    if (!existsSync(resolved)) {
      failures.push(`${relativePath}: missing linked path ${target}`);
    }
  }

  for (const match of content.matchAll(exampleCmdPattern)) {
    const examplePath = match[1];
    if (!examplePath) continue;
    const resolved = join(repoRoot, examplePath);
    if (!existsSync(resolved)) {
      failures.push(`${relativePath}: missing example in command ${examplePath}`);
    }
  }
}

if (failures.length === 0) {
  console.log(`Documentation validation passed for ${markdownFiles.length} markdown files.`);
  process.exit(0);
}

console.log('Documentation validation failed:');
for (const failure of failures) {
  console.log(`- ${failure}`);
}
process.exit(1);

#!/usr/bin/env node
/* global console, process */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const examplesDir = join(repoRoot, 'examples', 'app-server');
const expectationsPath = join(examplesDir, 'expectations.json');

const expectations = JSON.parse(readFileSync(expectationsPath, 'utf8'));
const defaults = expectations.default ?? {};
const perFile = expectations.files ?? {};
const allowCreatedPaths = Array.isArray(defaults.allowCreatedPaths)
  ? defaults.allowCreatedPaths
  : [];

const files = readdirSync(examplesDir)
  .filter((name) => name.endsWith('.mjs'))
  .sort();

const defaultTimeoutMs = Number(process.env.EXAMPLES_TIMEOUT_MS ?? defaults.timeoutMs ?? 180000);

const failures = [];
const rows = [];

function readChangedPaths() {
  const status = spawnSync('git', ['status', '--short'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 1024 * 1024,
  });

  if (status.error || status.status !== 0) {
    return null;
  }

  const paths = new Set();
  for (const line of (status.stdout ?? '').split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed.length === 0) continue;

    if (trimmed.startsWith('?? ')) {
      const path = trimmed.slice(3).trim();
      if (path.length > 0) paths.add(path);
      continue;
    }

    const arrowIndex = trimmed.indexOf(' -> ');
    if (arrowIndex > -1) {
      const renamedPath = trimmed.slice(arrowIndex + 4).trim();
      if (renamedPath.length > 0) paths.add(renamedPath);
      continue;
    }

    const path = trimmed.slice(3).trim();
    if (path.length > 0) paths.add(path);
  }

  return paths;
}

const baselineChangedPaths = readChangedPaths();

function isAllowedCreatedPath(path) {
  return allowCreatedPaths.some((allowed) => {
    if (typeof allowed !== 'string' || allowed.length === 0) return false;
    if (allowed.endsWith('/**')) {
      return path.startsWith(allowed.slice(0, -3));
    }
    return path === allowed;
  });
}

for (const file of files) {
  const filePath = join(examplesDir, file);
  const fileExpectation = perFile[file] ?? {};
  const timeoutMs = Number(fileExpectation.timeoutMs ?? defaultTimeoutMs);
  const skip = fileExpectation.skip === true;

  if (skip) {
    rows.push({
      file,
      status: 'SKIP',
      elapsedMs: 0,
      detail: fileExpectation.skipReason ?? 'skipped by expectation',
    });
    continue;
  }

  const requireNonEmptyStdout =
    fileExpectation.requireNonEmptyStdout ?? defaults.requireNonEmptyStdout ?? true;

  const mustInclude = [...(defaults.mustInclude ?? []), ...(fileExpectation.mustInclude ?? [])];
  const mustNotInclude = [
    ...(defaults.mustNotInclude ?? []),
    ...(fileExpectation.mustNotInclude ?? []),
  ];

  const start = Date.now();
  const run = spawnSync('node', [filePath], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: process.env,
    maxBuffer: 10 * 1024 * 1024,
  });
  const elapsedMs = Date.now() - start;

  const stdout = run.stdout ?? '';
  const stderr = run.stderr ?? '';
  const combined = `${stdout}\n${stderr}`;

  let error = undefined;
  if (run.error) {
    error = run.error.message;
  } else if (run.signal === 'SIGTERM' || run.signal === 'SIGKILL') {
    error = `timed out after ${timeoutMs}ms`;
  } else if (run.status !== 0) {
    error = `exit code ${run.status}`;
  } else if (requireNonEmptyStdout && stdout.trim().length === 0) {
    error = 'stdout is empty';
  }

  if (!error) {
    for (const text of mustInclude) {
      if (!combined.toLowerCase().includes(String(text).toLowerCase())) {
        error = `missing expected output: ${text}`;
        break;
      }
    }
  }

  if (!error) {
    for (const text of mustNotInclude) {
      if (combined.toLowerCase().includes(String(text).toLowerCase())) {
        error = `forbidden output matched: ${text}`;
        break;
      }
    }
  }

  rows.push({
    file,
    status: error ? 'FAIL' : 'PASS',
    elapsedMs,
    detail: error ? `${error} (timeout=${timeoutMs}ms)` : `- (timeout=${timeoutMs}ms)`,
  });

  if (error) {
    failures.push({ file, error, stdout, stderr });
  }
}

for (const row of rows) {
  const seconds = (row.elapsedMs / 1000).toFixed(1).padStart(6, ' ');
  console.log(`${row.status.padEnd(4)} ${seconds}s  ${row.file}  ${row.detail}`);
}

console.log('');
console.log(
  `Total: ${rows.length}, Passed: ${rows.length - failures.length}, Failed: ${failures.length}`,
);

if (failures.length > 0) {
  console.log('');
  console.log('Failures:');
  for (const failure of failures) {
    console.log(`- ${failure.file}: ${failure.error}`);
    const preview = `${failure.stdout}\n${failure.stderr}`.trim().slice(0, 500);
    if (preview.length > 0) {
      console.log(`  Output preview: ${preview.replace(/\n/g, ' | ')}`);
    }
  }
  process.exit(1);
}

const finalChangedPaths = readChangedPaths();
if (baselineChangedPaths && finalChangedPaths) {
  const newEntries = Array.from(finalChangedPaths)
    .filter((path) => !baselineChangedPaths.has(path))
    .filter((path) => !isAllowedCreatedPath(path));
  if (newEntries.length > 0) {
    console.log('');
    console.log('Example validation produced unexpected repo changes:');
    for (const path of newEntries) {
      console.log(`- ${path}`);
    }
    console.log('');
    if (allowCreatedPaths.length > 0) {
      console.log(`Allowed created paths: ${allowCreatedPaths.join(', ')}`);
    }
    console.log('Clean up generated artifacts (or allowlist intentional outputs) and run again.');
    process.exit(1);
  }
}

#!/usr/bin/env node

/**
 * Basic Object Generation Examples (Codex CLI)
 *
 * Demonstrates fundamental object generation with JSON schema using
 * the Codex CLI provider. Uses prompt engineering to enforce JSON-only output.
 */

import { generateObject } from 'ai';
import { codexCli } from '../dist/index.js';
import { z } from 'zod';

console.log('🎯 Codex CLI - Basic Object Generation\n');

const model = codexCli('gpt-5-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

// Example 1: Simple object with primitives
async function example1_simpleObject() {
  console.log('1️⃣  Simple Object with Primitives\n');

  const { object } = await generateObject({
    model,
    schema: z.object({
      name: z.string().describe('Full name of the person'),
      age: z.number().describe('Age in years'),
      email: z.string().email().describe('Valid email address'),
      isActive: z.boolean().describe('Whether the account is active'),
    }),
    prompt:
      'Generate a JSON object with a person profile for Alex Smith (age ~30) with a realistic email.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 2: Arrays
async function example2_arrays() {
  console.log('2️⃣  Object with Arrays\n');

  const { object } = await generateObject({
    model,
    schema: z.object({
      projectName: z.string(),
      languages: z.array(z.string()),
      contributors: z.array(z.string()),
      stars: z.number(),
      topics: z.array(z.string()),
    }),
    prompt: 'Generate data for an open-source TypeScript web framework project.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 3: Optional fields and basic constraints
async function example3_optionalFields() {
  console.log('3️⃣  Optional Fields & Constraints\n');

  const { object } = await generateObject({
    model,
    schema: z.object({
      title: z.string().describe('Book title'),
      author: z.string().describe('Author name'),
      isbn: z.string().describe('ISBN-13'),
      publishedYear: z.number().int().describe('Year of publication'),
      rating: z.number().min(0).max(5).optional().describe('Average rating 0-5'),
      awards: z.array(z.string()).optional().describe('Awards if any'),
    }),
    prompt: 'Generate metadata for a science fiction novel (not a real title).',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log();
}

await example1_simpleObject();
await example2_arrays();
await example3_optionalFields();

console.log('✅ Done');

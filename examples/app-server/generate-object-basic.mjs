#!/usr/bin/env node

/**
 * Basic Object Generation Examples (Codex CLI)
 *
 * Demonstrates fundamental object generation with JSON schema using
 * the Codex CLI provider. Uses native --output-schema for API-level
 * JSON enforcement (v0.2.0+). No prompt engineering needed!
 */

import { generateObject } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  console.log(' Codex CLI - Basic Object Generation\n');

  const model = appServer('gpt-5.3-codex', {});

  // Example 1: Simple object with primitives
  async function example1_simpleObject() {
    console.log('1  Simple Object with Primitives\n');

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
    console.log('2  Object with Arrays\n');

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

  // Example 3: Constraints (min/max)
  // NOTE: Optional fields are not supported with --output-schema (OpenAI strict mode limitation)
  async function example3_constraints() {
    console.log('3  Numeric Constraints\n');

    const { object } = await generateObject({
      model,
      schema: z.object({
        title: z.string().describe('Book title'),
        author: z.string().describe('Author name'),
        isbn: z.string().describe('ISBN-13'),
        publishedYear: z.number().int().describe('Year of publication'),
        rating: z.number().min(0).max(5).describe('Average rating 0-5'),
      }),
      prompt: 'Generate metadata for a science fiction novel (not a real title).',
    });

    console.log(JSON.stringify(object, null, 2));
    console.log();
  }

  await example1_simpleObject();
  await example2_arrays();
  await example3_constraints();

  console.log(' Done');
} finally {
  await appServer.close();
}

#!/usr/bin/env node

/**
 * Nested Object Generation (Codex CLI)
 *
 * Demonstrates complex nested structures using the Codex CLI provider
 * with prompt-engineered JSON-only outputs.
 */

import { generateObject } from 'ai';
import { codexCli } from '../dist/index.js';
import { z } from 'zod';

console.log('🏗️  Codex CLI - Nested Object Generation\n');

const model = codexCli('gpt-5.1', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

// Example 1: Company organization structure
async function example1_organization() {
  console.log('1️⃣  Organization Structure\n');

  const orgSchema = z.object({
    organization: z.object({
      name: z.string(),
      founded: z.number(),
      headquarters: z.object({
        address: z.string(),
        city: z.string(),
        country: z.string(),
        coordinates: z.object({ latitude: z.number(), longitude: z.number() }),
      }),
      departments: z.array(
        z.object({
          name: z.string(),
          head: z.string(),
          teams: z.array(
            z.object({
              name: z.string(),
              lead: z.string(),
              members: z.array(z.object({ name: z.string(), title: z.string() })),
            }),
          ),
        }),
      ),
    }),
  });

  const { object } = await generateObject({
    model,
    schema: orgSchema,
    prompt: 'Generate a realistic but fictional org chart for a 120-person AI startup.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 2: E‑commerce product with variants and inventory
async function example2_product() {
  console.log('2️⃣  Product with Variants & Inventory\n');

  const productSchema = z.object({
    sku: z.string(),
    title: z.string(),
    description: z.string(),
    categories: z.array(z.string()),
    price: z.number(),
    variants: z.array(
      z.object({
        id: z.string(),
        color: z.string(),
        size: z.string(),
        price: z.number(),
        inventory: z.object({
          available: z.number().int(),
          reserved: z.number().int(),
          warehouseLocation: z.string(),
        }),
      }),
    ),
    specs: z.object({
      weightKg: z.number(),
      dimensions: z.object({ w: z.number(), h: z.number(), d: z.number() }),
      materials: z.array(z.string()),
    }),
  });

  const { object } = await generateObject({
    model,
    schema: productSchema,
    prompt: 'Generate a product with 2-3 variants for a backpack designed for laptops.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log();
}

await example1_organization();
await example2_product();

console.log('✅ Done');

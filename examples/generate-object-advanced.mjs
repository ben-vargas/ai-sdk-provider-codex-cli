#!/usr/bin/env node

/**
 * Advanced Object Generation (Codex CLI)
 *
 * Complex, real-world schemas using native --output-schema for API-level
 * JSON enforcement. Reliable structured output without prompt engineering.
 */

import { generateObject } from 'ai';
import { codexCli } from '../dist/index.js';
import { z } from 'zod';

console.log('🚀 Codex CLI - Advanced Object Generation\n');

// Use the Codex flagship model to exercise extra-high reasoning effort.
// Requires codex-cli >= 0.60 for gpt-5.1-codex-max + xhigh.
const model = codexCli('gpt-5.1-codex-max', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
  reasoningEffort: 'xhigh', // codex-max and newer models that expose xhigh; deeper reasoning for structured outputs
});

// Example 1: Product comparison with scoring and rationale
async function example1_productComparison() {
  console.log('1️⃣  Product Comparison with Scoring\n');

  const comparisonSchema = z.object({
    products: z
      .array(
        z.object({
          name: z.string(),
          summary: z.string(),
          pros: z.array(z.string()).min(3),
          cons: z.array(z.string()).min(2),
          score: z.number().min(0).max(10),
        }),
      )
      .length(2),
    bestBuy: z.string().describe('Name of the recommended product'),
    rationale: z.string().describe('Why the recommended product wins'),
  });

  const prompt = `Compare these two phones for a power user and score them from 0-10.

Phone A (Falcon X2):
- 6.7" OLED 120Hz
- Snapdragon 8
- 12GB RAM / 256GB storage
- 4500mAh, 65W fast charge
- $849

Phone B (Aurora Pro):
- 6.8" LTPO 120Hz
- Custom NPU + flagship SoC
- 16GB RAM / 512GB storage
- 5200mAh, 80W fast charge
- $1099
`;

  const { object } = await generateObject({ model, schema: comparisonSchema, prompt });
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 2: HTML content extraction to typed JSON
async function example2_htmlExtraction() {
  console.log('2️⃣  HTML Content Extraction\n');

  const articleSchema = z.object({
    title: z.string(),
    author: z.string(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}/)
      .describe('YYYY-MM-DD'),
    tags: z.array(z.string()).min(1),
    summary: z.string().describe('2-3 sentence summary'),
    links: z.array(z.object({ text: z.string(), href: z.string().url() })),
  });

  const html = `
<article>
  <h1>Type-Safe APIs with Zod</h1>
  <div class="byline">By Jane Developer • 2025-07-29</div>
  <p>Zod is a TypeScript-first schema validation library that pairs nicely with API builders.</p>
  <p>In this guide, we explore patterns for validating inputs and emitting typed outputs.</p>
  <ul class="tags">
    <li>typescript</li>
    <li>validation</li>
    <li>api-design</li>
  </ul>
  <a href="https://zod.dev">Official Site</a>
  <a href="https://github.com/colinhacks/zod">GitHub</a>
</article>`;

  const prompt = `Extract the article metadata from this HTML and produce JSON adhering to the schema. If any field is missing, infer reasonably from context.

${html}
`;

  const { object } = await generateObject({ model, schema: articleSchema, prompt });
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 3: Incident classification with enums and derived fields
async function example3_incidentClassification() {
  console.log('3️⃣  Incident Classification\n');

  const incidentSchema = z.object({
    id: z.string(),
    category: z.enum(['security', 'availability', 'data-integrity', 'compliance']),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    summary: z.string(),
    impactedSystems: z.array(z.string()).min(1),
    customerImpact: z.boolean(),
    recommendedActions: z.array(z.string()).min(2),
  });

  const prompt = `Classify the following incident and provide recommended actions.

"On 2025-08-18, our US-East application tier experienced intermittent 502 responses for ~12 minutes. Root cause appears to be a surge of cold starts after a configuration rollout. No data loss; elevated error rates only. Customers briefly experienced failures on write operations. Automatic retry mitigations were partially effective. Rollback completed at T+10m."
`;

  const { object } = await generateObject({ model, schema: incidentSchema, prompt });
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

await example1_productComparison();
await example2_htmlExtraction();
await example3_incidentClassification();

console.log('✅ Advanced examples complete');

#!/usr/bin/env node

/**
 * Native JSON Schema Showcase (Codex CLI v0.2.0+)
 *
 * Demonstrates the power of native --output-schema support:
 * - API-level schema enforcement (strict mode)
 * - No prompt engineering overhead
 * - 100-200 fewer tokens per request
 * - More reliable structured output
 */

import { generateObject } from 'ai';
import { codexCli } from '../dist/index.js';
import { z } from 'zod';

console.log('🎯 Native JSON Schema Showcase\n');
console.log('This example demonstrates v0.2.0 native schema support.');
console.log('The schema is passed to OpenAI API with strict: true.\n');
console.log('Benefits:');
console.log('  ✅ No verbose JSON instructions in prompt');
console.log('  ✅ 100-200 fewer tokens per request');
console.log('  ✅ API-level enforcement (more reliable)');
console.log('  ✅ Guaranteed valid JSON output\n');

const model = codexCli('gpt-5.1', {
  allowNpx: true,
  skipGitRepoCheck: true,
  dangerouslyBypassApprovalsAndSandbox: true, // For examples only!
  color: 'never',
});

// Example 1: Complex nested schema with constraints
async function example1_complexSchema() {
  console.log('1️⃣  Complex Nested Schema with Constraints\n');

  const schema = z.object({
    company: z.object({
      name: z.string(),
      founded: z.number().int().min(1800).max(2025),
      employees: z.number().int().positive(),
      public: z.boolean(),
    }),
    products: z
      .array(
        z.object({
          name: z.string(),
          category: z.enum(['software', 'hardware', 'service']),
          price: z.number().positive(),
          rating: z.number().min(0).max(5),
        }),
      )
      .min(2)
      .max(5),
    headquarters: z.object({
      city: z.string(),
      country: z.string(),
      coordinates: z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      }),
    }),
  });

  // Notice: No JSON instructions in the prompt!
  // The schema is enforced at the API level.
  const { object } = await generateObject({
    model,
    schema,
    prompt: 'Generate realistic data for a mid-size tech company that makes productivity software.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log('\n✅ Schema enforced by API, not prompt engineering!\n');
}

// Example 2: Enum-heavy schema
async function example2_enumSchema() {
  console.log('2️⃣  Schema with Multiple Enums\n');

  const schema = z.object({
    incident: z.object({
      id: z.string().describe('Incident ID in format INC-XXXXXX'),
      severity: z.enum(['low', 'medium', 'high', 'critical']),
      status: z.enum(['open', 'investigating', 'resolved', 'closed']),
      category: z.enum(['security', 'availability', 'performance', 'data-integrity']),
      priority: z.enum(['p0', 'p1', 'p2', 'p3', 'p4']),
    }),
    impact: z.object({
      affectedUsers: z.number().int().nonnegative(),
      affectedServices: z.array(z.string()).min(1),
      estimatedDowntime: z.number().nonnegative(),
      customerImpact: z.boolean(),
    }),
    response: z.object({
      assignedTeam: z.string(),
      eta: z.string(),
      actions: z.array(z.string()).min(2),
    }),
  });

  const { object } = await generateObject({
    model,
    schema,
    prompt:
      'Create an incident report for a database connection pool exhaustion that affected 500 users.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log('\n✅ All enums validated at API level!\n');
}

// Example 3: Complex types with arrays
// NOTE: Optional fields and regex patterns not supported in OpenAI strict mode
async function example3_complexTypes() {
  console.log('3️⃣  Complex Nested Types\n');

  const schema = z.object({
    user: z.object({
      id: z.string().describe('User ID'),
      username: z.string().min(3).max(20),
      email: z.string().describe('Email address'),
      verified: z.boolean(),
      role: z.enum(['admin', 'moderator', 'user', 'guest']),
    }),
    profile: z.object({
      displayName: z.string(),
      bio: z.string(),
      socialLinks: z
        .array(
          z.object({
            platform: z.enum(['twitter', 'github', 'linkedin', 'website']),
            url: z.string().describe('Profile URL'),
          }),
        )
        .min(1),
    }),
    stats: z.object({
      postsCount: z.number().int().nonnegative(),
      followersCount: z.number().int().nonnegative(),
      reputation: z.number().int().min(0).max(10000),
      joinedDaysAgo: z.number().int().positive(),
    }),
  });

  const { object } = await generateObject({
    model,
    schema,
    prompt: 'Generate a user profile for an active community member with moderate reputation.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log('\n✅ Complex nested objects validated!\n');
}

await example1_complexSchema();
await example2_enumSchema();
await example3_complexTypes();

console.log('✅ Native schema showcase complete!');
console.log('\n💡 Key Takeaway:');
console.log('   With v0.2.0, schemas are enforced by the OpenAI API');
console.log('   using strict mode. No prompt engineering needed!');

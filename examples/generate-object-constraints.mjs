#!/usr/bin/env node

/**
 * Object Generation with Constraints (Codex CLI)
 *
 * Shows validation rules: enums, ranges, regex, and logical constraints.
 */

import { generateObject } from 'ai';
import { codexCli } from '../dist/index.js';
import { z } from 'zod';

console.log('🧪 Codex CLI - Object Generation with Constraints\n');

const model = codexCli('gpt-5', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

// Example 1: User account with constraints
async function example1_userAccount() {
  console.log('1️⃣  User Account\n');

  const userSchema = z.object({
    id: z.string().uuid().describe('Unique user id (UUID)'),
    username: z.string().min(3).max(20),
    email: z.string().email(),
    status: z.enum(['pending', 'active', 'suspended']),
    role: z.enum(['user', 'admin', 'moderator']),
    createdAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}/)
      .describe('YYYY-MM-DD'),
    website: z.string().url().optional(),
  });

  const { object } = await generateObject({
    model,
    schema: userSchema,
    prompt: 'Generate a new user account for a tech forum.',
  });
  console.log(JSON.stringify(object, null, 2));
  console.log();
}

// Example 2: Booking with logical constraints in prompt
async function example2_booking() {
  console.log('2️⃣  Booking with Logical Constraints\n');

  const bookingSchema = z.object({
    bookingId: z.string().uuid(),
    guestName: z.string(),
    checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    roomType: z.enum(['standard', 'deluxe', 'suite']),
    guests: z.number().int().min(1).max(4),
    totalUsd: z.number().positive(),
  });

  const { object } = await generateObject({
    model,
    schema: bookingSchema,
    prompt:
      'Generate a hotel booking where checkOut is after checkIn and totalUsd matches a plausible 2-night stay.',
  });

  console.log(JSON.stringify(object, null, 2));
  console.log();
}

await example1_userAccount();
await example2_booking();

console.log('✅ Done');

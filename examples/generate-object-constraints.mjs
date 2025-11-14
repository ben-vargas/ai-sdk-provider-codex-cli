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

const model = codexCli('gpt-5.1', {
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
    id: z.string().describe('Unique user id (UUID format)'),
    username: z.string().min(3).max(20),
    email: z.string().describe('Valid email address'),
    status: z.enum(['pending', 'active', 'suspended']),
    role: z.enum(['user', 'admin', 'moderator']),
    createdAt: z.string().describe('Creation date in YYYY-MM-DD format'),
    website: z.string().describe('Personal website URL (or empty string if none)'),
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
    bookingId: z.string().describe('Booking ID in UUID format'),
    guestName: z.string(),
    checkIn: z.string().describe('Check-in date in YYYY-MM-DD format'),
    checkOut: z.string().describe('Check-out date in YYYY-MM-DD format'),
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

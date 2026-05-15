#!/usr/bin/env node

/**
 * Experimental JSON Events (Codex CLI)
 *
 * Demonstrates the --experimental-json event format.
 * This example shows how the provider parses events like:
 * - thread.started
 * - turn.started / turn.completed
 * - item.started / item.updated / item.completed
 * - Usage tracking from turn.completed events
 */

import { generateText, streamText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

console.log(' Experimental JSON Events\n');
console.log('This example demonstrates the current Codex CLI event format.');
console.log('Events are parsed from --experimental-json output.\n');

const model = codexExec('gpt-5.5', {
  allowNpx: true,
  skipGitRepoCheck: true,
  dangerouslyBypassApprovalsAndSandbox: true, // For examples only!
  color: 'never',
});

function getUsageTotals(usage) {
  const inputTokens =
    typeof usage.inputTokens === 'number' ? usage.inputTokens : (usage.inputTokens?.total ?? 0);
  const outputTokens =
    typeof usage.outputTokens === 'number' ? usage.outputTokens : (usage.outputTokens?.total ?? 0);
  const totalTokens = usage.totalTokens ?? inputTokens + outputTokens;
  const cacheRead =
    usage.cachedInputTokens ??
    usage.inputTokenDetails?.cacheReadTokens ??
    usage.inputTokens?.cacheRead;

  return { inputTokens, outputTokens, totalTokens, cacheRead };
}

// Example 1: Basic text generation with usage tracking
async function example1_basicWithUsage() {
  console.log('1  Basic Generation with Usage Tracking\n');

  const { text, usage, response } = await generateText({
    model,
    prompt: 'Explain the concept of native JSON schema support in 2 sentences.',
  });

  console.log(' Response:');
  console.log(text);
  console.log('\n Usage (from turn.completed event):');
  const totals = getUsageTotals(usage);
  console.log(`   Input tokens:  ${totals.inputTokens}`);
  console.log(`   Output tokens: ${totals.outputTokens}`);
  console.log(`   Total tokens:  ${totals.totalTokens}`);
  if (totals.cacheRead) {
    console.log(`   Cache read:    ${totals.cacheRead}`);
  }
  console.log('\n Response metadata:');
  console.log(`   ID:        ${response.id}`);
  console.log(`   Model:     ${response.modelId}`);
  console.log(`   Timestamp: ${response.timestamp.toISOString()}`);
  console.log();
}

// Example 2: Event flow explanation
async function example2_eventFlow() {
  console.log('2  Understanding Event Flow\n');

  console.log('When you call generateText or generateObject, the provider:');
  console.log('  1. Spawns `codex exec --experimental-json`');
  console.log('  2. Parses JSONL events from stdout');
  console.log('  3. Extracts key data:');
  console.log('     - thread.started      session/thread id');
  console.log('     - item.completed      assistant message text');
  console.log('     - turn.completed      usage stats');
  console.log('  4. Maps events to AI SDK format');
  console.log('  5. Returns structured response\n');

  console.log('Event types in --experimental-json:');
  console.log('   thread.started    - Thread/session initialization');
  console.log('   turn.started      - Turn begins');
  console.log('   turn.completed    - Turn ends (includes usage)');
  console.log('   item.started      - Item begins (command, file change, etc.)');
  console.log('   item.updated      - Item progress update');
  console.log('   item.completed    - Item finishes');
  console.log('   error             - Error occurred\n');
}

// Example 3: Streaming with events
async function example3_streamingEvents() {
  console.log('3  Streaming with Event Metadata\n');

  const { textStream } = await streamText({
    model,
    prompt: 'List 3 benefits of API-level JSON schema enforcement.',
  });

  console.log(' Streaming response...\n');

  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }

  console.log('\n\n Stream complete!');
  console.log('   Note: --experimental-json suppresses deltas,');
  console.log('   so you typically get a final chunk instead of many small ones.\n');
}

await example1_basicWithUsage();
await example2_eventFlow();
await example3_streamingEvents();

console.log(' Event showcase complete!');
console.log('\n Key Takeaway:');
console.log('   The experimental JSON format provides:');
console.log('   - Structured event types');
console.log('   - Usage tracking');
console.log('   - Better observability');

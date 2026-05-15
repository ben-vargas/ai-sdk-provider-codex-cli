#!/usr/bin/env node

/**
 * App-Server JSON Events (Codex CLI)
 *
 * Demonstrates the codex app-server JSON-RPC event stream.
 * This example shows how the provider maps notifications like:
 * - thread.started
 * - turn.started / turn.completed
 * - item.started / item.updated / item.completed
 * - Usage tracking from turn.completed events
 */

import { generateText, streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.130.0', idleTimeoutMs: 30000 },
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

try {
  console.log(' App-Server JSON Events\n');
  console.log('This example demonstrates the codex app-server JSON-RPC event stream.');
  console.log('Events are parsed from app-server notifications.\n');

  const model = appServer('gpt-5.5', {});

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
    console.log('  1. Starts or reuses a `codex app-server` JSON-RPC process');
    console.log('  2. Sends thread/start and turn/start requests');
    console.log('  3. Extracts key data:');
    console.log('     - thread.started      thread id');
    console.log('     - item.completed      assistant message text');
    console.log('     - turn.completed      usage stats');
    console.log('  4. Maps events to AI SDK format');
    console.log('  5. Returns structured response\n');

    console.log('Common app-server event types:');
    console.log('   thread.started    - Thread initialization');
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
    console.log('   Note: app-server event streams may deliver final text');
    console.log('   chunks instead of many small token-level deltas.\n');
  }

  await example1_basicWithUsage();
  await example2_eventFlow();
  await example3_streamingEvents();

  console.log(' Event showcase complete!');
  console.log('\n Key Takeaway:');
  console.log('   The app-server JSON-RPC event stream provides:');
  console.log('   - Structured event types');
  console.log('   - Usage tracking');
  console.log('   - Better observability');
} finally {
  await appServer.close();
}

/**
 * Default Logging Example
 *
 * Run: node examples/logging-default.mjs
 *
 * This example demonstrates the default logging behavior of Codex CLI provider.
 * By default, only warn and error messages are logged.
 * Debug and info messages are suppressed unless verbose mode is enabled.
 *
 * Expected output:
 * - No debug or info logs
 * - Only warn/error logs if something goes wrong
 * - Clean output focused on the actual response
 */

import { streamText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

async function main() {
  console.log('=== Default Logging (Non-Verbose Mode) ===\n');
  console.log('Expected behavior:');
  console.log('- No debug or info logs');
  console.log('- Only warn/error logs appear if needed');
  console.log('- Clean output showing just the response\n');

  try {
    // Default logging - only warn/error messages will appear
    const result = streamText({
      model: codexCli('gpt-5.1', {
        allowNpx: true,
        skipGitRepoCheck: true,
        approvalMode: 'on-failure',
        sandboxMode: 'workspace-write',
      }),
      prompt: 'Say hello in 5 words',
    });

    // Stream the response
    console.log('Response:');
    for await (const textPart of result.textStream) {
      process.stdout.write(textPart);
    }
    console.log('\n');

    // Get usage info
    const usage = await result.usage;
    console.log('Token usage:', usage);

    console.log('\n✓ Notice: No debug or info logs appeared above');
    console.log('  This is the default behavior - only essential output is shown');
  } catch (error) {
    console.error('Error:', error);
    console.log('\n💡 Troubleshooting:');
    console.log('1. Install Codex CLI: npm install -g @openai/codex');
    console.log('2. Authenticate: codex login (or set OPENAI_API_KEY)');
    console.log('3. Run check-cli.mjs to verify setup');
  }
}

main().catch(console.error);

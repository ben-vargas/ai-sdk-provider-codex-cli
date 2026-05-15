/**
 * Default Logging Example
 *
 * Run: node examples/app-server/logging-default.mjs
 *
 * This example demonstrates the default app-server logging behavior.
 * By default, routine request debug output is suppressed. You may still see
 * lifecycle info from the shared app-server client when the process closes.
 *
 * Expected output:
 * - No debug logs
 * - Warn/error logs if something goes wrong
 * - Possible app-server lifecycle info when the client closes
 * - Clean output focused on the actual response
 */

import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.130.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    console.log('=== Default Logging (Non-Verbose Mode) ===\n');
    console.log('Expected behavior:');
    console.log('- No debug logs');
    console.log('- Warn/error logs appear if needed');
    console.log('- App-server lifecycle info may appear when the process closes');
    console.log('- Clean output showing just the response\n');

    try {
      // Default logging suppresses request-level debug output.
      const result = streamText({
        model: appServer('gpt-5.5', {
          approvalPolicy: 'on-failure',
          sandboxPolicy: { type: 'workspaceWrite' },
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

      console.log('\n Notice: No debug logs appeared above');
      console.log('  Routine request tracing is hidden in the default mode');
    } catch (error) {
      console.error('Error:', error);
      console.log('\n Troubleshooting:');
      console.log('1. Install Codex CLI: npm install -g @openai/codex');
      console.log('2. Authenticate: codex login (or set OPENAI_API_KEY)');
      console.log('3. Run check-cli.mjs to verify setup');
    }
  }

  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} finally {
  await appServer.close();
}

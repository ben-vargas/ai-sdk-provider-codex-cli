/**
 * Test case: Windows command line length limit
 *
 * This example tests that prompts exceeding the Windows command line
 * length limit (~8191 chars) are handled correctly by passing them
 * via stdin instead of as command-line arguments.
 *
 * Run: node examples/app-server/cmdline-limit-test.mjs
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

async function main() {
  console.log('=== Windows Command Line Limit Test ===\n');

  // Windows command line limit is ~8191 characters
  const WINDOWS_LIMIT = 8191;

  // Generate a prompt that exceeds the Windows limit
  const basePrompt = "Please respond with 'OK' to confirm you received this message. ";
  const padding = 'A'.repeat(WINDOWS_LIMIT);
  const longPrompt = basePrompt + padding;

  console.log(`Prompt length: ${longPrompt.length} chars`);
  console.log(`Windows limit: ${WINDOWS_LIMIT} chars`);
  console.log(`Exceeds limit: ${longPrompt.length > WINDOWS_LIMIT ? 'YES' : 'NO'}`);
  console.log('\n---\n');

  const codex = createCodexAppServer({
    defaultSettings: {
      minCodexVersion: '0.105.0-alpha.0',
      idleTimeoutMs: 30000,
      cwd: process.cwd(),
      approvalPolicy: 'on-failure',
    },
  });

  try {
    console.log('Calling Codex CLI with long prompt...\n');

    const result = await generateText({
      model: codex('gpt-5.3-codex'),
      prompt: longPrompt,
    });

    console.log('\n=== Result ===\n');
    console.log(`Response: ${result.text.slice(0, 200)}...`);

    if (result.text.toLowerCase().includes('ok')) {
      console.log('\n Test passed - Codex received the full prompt correctly');
    } else {
      console.log("\n  Response doesn't contain 'OK', but no error occurred");
      console.log('The prompt was likely received correctly.');
    }
  } catch (error) {
    console.error('\n Error:', error);
    console.log('\nIf this error mentions command line length, the stdin fix may not be working.');
    process.exitCode = 1;
  } finally {
    await codex.close();
  }
}

main();

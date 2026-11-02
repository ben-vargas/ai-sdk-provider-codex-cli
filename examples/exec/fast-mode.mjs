// Run: node examples/exec/fast-mode.mjs
//
// Codex "fast mode" (service tier): faster responses in exchange for higher
// usage (Fast consumes 2.5x of a ChatGPT plan's included limits; API keys pay
// the API fast-mode rate). Availability depends on the model and your account:
// Codex drops a tier the model does not advertise and logs a warning on stderr
// instead of failing, so the request still runs at standard speed.

import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

async function main() {
  const model = codexExec('gpt-6-sol', {
    allowNpx: true,
    skipGitRepoCheck: true,
    reasoningEffort: 'medium',
    serviceTier: 'fast', // emitted as -c service_tier="fast"
  });

  console.log('=== Fast mode (serviceTier: fast) ===');
  let started = Date.now();
  const fast = await generateText({
    model,
    prompt: 'Reply with exactly: Fast mode works.',
  });
  console.log(fast.text);
  console.log(`Elapsed: ${Date.now() - started} ms`);

  // Per-call: 'default' forces standard speed for this request only.
  console.log('\n=== Standard speed for one call (serviceTier: default) ===');
  started = Date.now();
  const standard = await generateText({
    model,
    prompt: 'Reply with exactly: Standard speed works.',
    providerOptions: {
      'codex-cli': {
        serviceTier: 'default',
      },
    },
  });
  console.log(standard.text);
  console.log(`Elapsed: ${Date.now() - started} ms`);

  console.log('\nFast mode example complete.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

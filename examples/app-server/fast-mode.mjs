// Run: node examples/app-server/fast-mode.mjs
//
// Codex "fast mode" (service tier): faster responses in exchange for higher
// usage (Fast consumes 2.5x of a ChatGPT plan's included limits; API keys pay
// the API fast-mode rate). Availability depends on the model and your account:
// Codex drops a tier the model does not advertise and logs a warning instead
// of failing, so check `serviceTiers` from listModels() first.

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.156.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    const modelId = 'gpt-6-sol';

    console.log(`=== Service tiers advertised for ${modelId} ===`);
    const { models } = await appServer.listModels();
    const catalog = models.find((model) => model.id === modelId);
    const tiers = catalog?.serviceTiers ?? [];
    console.log(
      tiers.length > 0
        ? tiers.map((tier) => `${tier.id} (${tier.name}: ${tier.description})`).join(', ')
        : 'none advertised (Codex will omit the tier and run at standard speed)',
    );
    console.log('Default tier:', catalog?.defaultServiceTier ?? 'standard');

    // Model-level: serviceTier is sent on thread/start, thread/resume and every turn/start.
    const model = appServer(modelId, { effort: 'medium', serviceTier: 'fast' });

    console.log('\n=== Fast mode (serviceTier: fast) ===');
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
        'codex-app-server': {
          serviceTier: 'default',
        },
      },
    });
    console.log(standard.text);
    console.log(`Elapsed: ${Date.now() - started} ms`);

    console.log('\nFast mode example complete.');
  }

  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} finally {
  await appServer.close();
}

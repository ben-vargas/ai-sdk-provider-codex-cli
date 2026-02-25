// Run: node examples/app-server/list-models.mjs

import { listModels } from 'ai-sdk-provider-codex-cli';

const { models, defaultModel } = await listModels({
  minCodexVersion: '0.105.0-alpha.0',
});

console.log(`Found ${models.length} model(s).`);
if (defaultModel) {
  console.log(`Default model: ${defaultModel.id}`);
}

for (const model of models) {
  const provider = model.modelProvider ?? 'unknown-provider';
  const desc = model.description ?? model.name ?? '';
  console.log(`- ${model.id} (${provider}) ${desc}`.trim());
}

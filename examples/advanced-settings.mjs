import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

async function main() {
  // Example 1: High reasoning effort
  console.log('=== Example 1: Deep Reasoning ===');
  const deepThinking = codexCli('gpt-5-codex', {
    allowNpx: true,
    skipGitRepoCheck: true,
    reasoningEffort: 'high',
    reasoningSummary: 'detailed',
    modelVerbosity: 'medium',
  });

  const result1 = await generateText({
    model: deepThinking,
    prompt:
      'Solve: Three switches control three bulbs in another room. You can only enter the room once. How do you determine which switch controls which bulb?',
  });
  console.log(result1.text);

  // Example 2: Web search enabled
  console.log('\n=== Example 2: Web Search ===');
  const withWebSearch = codexCli('gpt-5', {
    allowNpx: true,
    skipGitRepoCheck: true,
    webSearch: true,
  });

  const result2 = await generateText({
    model: withWebSearch,
    prompt: 'What are the latest features in Node.js 23?',
  });
  console.log(result2.text);

  // Example 3: Generic config overrides
  console.log('\n=== Example 3: Advanced Config ===');
  const advanced = codexCli('gpt-5-codex', {
    allowNpx: true,
    configOverrides: {
      model_context_window: 200000,
      hide_agent_reasoning: false,
      sandbox_workspace_write: { network_access: true },
    },
  });

  const result3 = await generateText({
    model: advanced,
    prompt: 'Design a microservices architecture...',
  });
  console.log(result3.text);

  // Example 4: Combined settings
  console.log('\n=== Example 4: All Features ===');
  const fullFeatured = codexCli('gpt-5-codex', {
    allowNpx: true,
    skipGitRepoCheck: true,
    includePlanTool: true,

    // Custom
    configOverrides: {
      sandbox_workspace_write: { network_access: true },
    },
  });

  const result4 = await generateText({
    model: fullFeatured,
    prompt: 'Outline a two-step plan for verifying deployment readiness, then summarize it.',
  });
  console.log(result4.text);
}

main().catch(console.error);

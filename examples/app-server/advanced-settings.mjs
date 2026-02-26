import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    // Example 1: High reasoning effort
    console.log('=== Example 1: Deep Reasoning ===');
    const deepThinking = appServer('gpt-5.3-codex', {
      effort: 'high',
      summary: 'detailed',
    });

    const result1 = await generateText({
      model: deepThinking,
      prompt:
        'Solve: Three switches control three bulbs in another room. You can only enter the room once. How do you determine which switch controls which bulb?',
    });
    console.log(result1.text);

    // Example 2: Personality/summary tuning
    console.log('\n=== Example 2: Personality + Summary ===');
    const withPersonality = appServer('gpt-5.3-codex', {
      personality: 'friendly',
      summary: 'concise',
    });

    const result2 = await generateText({
      model: withPersonality,
      prompt: 'Explain the Node.js event loop in three bullet points.',
    });
    console.log(result2.text);

    // Example 3: Generic config overrides
    console.log('\n=== Example 3: Advanced Config ===');
    const advanced = appServer('gpt-5.3-codex', {
      configOverrides: {
        model_context_window: 200000,
        hide_agent_reasoning: false,
        sandbox_workspace_write: { network_access: true },
      },
    });

    const result3 = await generateText({
      model: advanced,
      prompt: 'List three tradeoffs between microservices and a monolith.',
    });
    console.log(result3.text);

    // Example 4: Combined settings (safe, self-contained)
    console.log('\n=== Example 4: Combined Settings ===');
    const fullFeatured = appServer('gpt-5.3-codex', {
      effort: 'medium',
      summary: 'detailed',
      personality: 'pragmatic',
      configOverrides: {
        sandbox_workspace_write: { network_access: true },
      },
    });

    const result4 = await generateText({
      model: fullFeatured,
      prompt: 'Outline a two-step plan for verifying deployment readiness, then summarize it.',
    });
    console.log(result4.text);

    console.log('\nAdvanced settings example complete.');
  }

  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} finally {
  await appServer.close();
}

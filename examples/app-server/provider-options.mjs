import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    const model = appServer('gpt-5.3-codex', {
      effort: 'low',
    });

    console.log('=== Quick Response (Low Effort) ===');
    const quick = await generateText({
      model,
      prompt: 'Summarize JSON schema validation in one short sentence.',
      providerOptions: {
        'codex-app-server': {
          effort: 'low',
        },
      },
    });
    console.log(quick.text);

    console.log('\n=== Deep Analysis (High Effort) ===');
    const deep = await generateText({
      model,
      prompt: 'Compare event-driven and batch ETL in exactly 2 concise bullets.',
      providerOptions: {
        'codex-app-server': {
          effort: 'medium',
        },
      },
    });
    console.log(deep.text);

    console.log('\n=== Custom Config Overrides per Call ===');
    const tuned = await generateText({
      model,
      prompt: 'Reply with exactly: Config overrides applied.',
      providerOptions: {
        'codex-app-server': {
          configOverrides: {
            experimental_resume: 'provider-options.jsonl',
            'sandbox_workspace_write.network_access': true,
          },
        },
      },
    });
    console.log(tuned.text);

    console.log('\n=== Per-call MCP override ===');
    const withMcp = await generateText({
      model,
      prompt: 'Reply with exactly: MCP override configured.',
      providerOptions: {
        'codex-app-server': {
          rmcpClient: true,
          mcpServers: {
            docs: {
              transport: 'http',
              url: 'https://mcp.example/api',
              bearerTokenEnvVar: 'MCP_BEARER',
            },
          },
        },
      },
    });
    console.log(withMcp.text);

    console.log('\nProvider options example complete.');
  }

  await main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} finally {
  await appServer.close();
}

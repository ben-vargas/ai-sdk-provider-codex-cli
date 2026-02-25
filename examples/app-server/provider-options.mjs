import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  async function main() {
    const model = appServer('gpt-5.3-codex', {
      effort: 'medium',
      summary: 'concise',
    });

    console.log('=== Quick Response (Low Effort) ===');
    const quick = await generateText({
      model,
      prompt: 'Summarize JSON schema validation in two sentences.',
      providerOptions: {
        'codex-app-server': {
          effort: 'low',
          summary: 'concise',
        },
      },
    });
    console.log(quick.text);

    console.log('\n=== Deep Analysis (High Effort) ===');
    const deep = await generateText({
      model,
      prompt: 'Compare event-driven and batch ETL pipelines for log analytics workloads.',
      providerOptions: {
        'codex-app-server': {
          effort: 'high',
          summary: 'detailed',
        },
      },
    });
    console.log(deep.text);

    console.log('\n=== Custom Config Overrides per Call ===');
    const tuned = await generateText({
      model,
      prompt: 'List the Codex CLI features enabled for this request.',
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
      prompt: 'Ping the docs MCP for /status.',
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
  }

  await main().catch(console.error);
} finally {
  await appServer.close();
}

import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

async function main() {
  const model = codexCli('gpt-5.1-codex', {
    allowNpx: true,
    skipGitRepoCheck: true,
    reasoningEffort: 'medium',
    modelVerbosity: 'medium',
  });

  console.log('=== Quick Response (Low Effort) ===');
  const quick = await generateText({
    model,
    prompt: 'Summarize JSON schema validation in two sentences.',
    providerOptions: {
      'codex-cli': {
        reasoningEffort: 'low',
        textVerbosity: 'low',
      },
    },
  });
  console.log(quick.text);

  console.log('\n=== Deep Analysis (High Effort) ===');
  const deep = await generateText({
    model,
    prompt: 'Compare event-driven and batch ETL pipelines for log analytics workloads.',
    providerOptions: {
      'codex-cli': {
        reasoningEffort: 'high',
        reasoningSummary: 'detailed',
        textVerbosity: 'high',
      },
    },
  });
  console.log(deep.text);

  console.log('\n=== Custom Config Overrides per Call ===');
  const tuned = await generateText({
    model,
    prompt: 'List the Codex CLI features enabled for this request.',
    providerOptions: {
      'codex-cli': {
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
      'codex-cli': {
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

main().catch(console.error);

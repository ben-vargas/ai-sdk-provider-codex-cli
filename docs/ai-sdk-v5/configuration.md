# Configuration Reference

This provider wraps the `codex exec` CLI in non‑interactive mode and maps settings to CLI flags/config overrides.

## Settings

- `allowNpx` (boolean): If true, runs `npx -y @openai/codex` when Codex isn’t found on PATH.
- `codexPath` (string): Explicit path to Codex CLI executable (e.g. `/opt/homebrew/bin/codex`) or JS entry (`bin/codex.js`), bypassing PATH resolution.
- `cwd` (string): Working directory for the spawned process.
- `addDirs` (string[]): Additional directories Codex can read/write. Emits one `--add-dir <path>` per entry (useful in monorepos or when sharing resources across packages).
- `color` ('always' | 'never' | 'auto'): Controls ANSI color emission.
- `skipGitRepoCheck` (boolean): When true, passes `--skip-git-repo-check`.
- `fullAuto` (boolean): Sets `--full-auto` (low-friction sandboxed execution).
- `dangerouslyBypassApprovalsAndSandbox` (boolean): Maps to `--dangerously-bypass-approvals-and-sandbox`.
- `approvalMode` ('untrusted' | 'on-failure' | 'on-request' | 'never'): Applied via `-c approval_policy=...`.
- `sandboxMode` ('read-only' | 'workspace-write' | 'danger-full-access'): Applied via `-c sandbox_mode=...`.
- `outputLastMessageFile` (string): File path to write the last agent message. If omitted, a temp file is created.
- `env` (Record<string,string>): Extra env vars for the child process (e.g., `OPENAI_API_KEY`).
- `verbose` (boolean): Enable verbose logging mode. When `true`, enables `debug` and `info` log levels. When `false` (default), only `warn` and `error` are logged.
- `logger` (Logger | false): Custom logger object or `false` to disable logging entirely. Logger must implement four methods: `debug`, `info`, `warn`, and `error`. Default uses `console.*` methods.
- `rmcpClient` (boolean): Enable the RMCP client so HTTP-based MCP servers can be reached (`-c features.rmcp_client=true`).
- `mcpServers` (Record<string, McpServerConfig>): Define MCP servers (stdio or HTTP). Keys are server names; values follow the shapes below.

## Model Parameters & Advanced Options (v0.4.0+)

### Reasoning & Verbosity

- **`reasoningEffort`** ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): Controls reasoning depth for reasoning-capable models (o3, o4-mini, the GPT‑5.1/5.2 families, and legacy GPT‑5). Higher effort produces more thorough reasoning at the cost of latency. Maps to `-c model_reasoning_effort=<value>`.
  - Per the Codex CLI model preset definitions (`codex-rs/common/src/model_presets.rs`), `gpt-5.1` and `gpt-5.1-codex` expose `low`, `medium`, and `high`; `gpt-5.1-codex-max` adds `xhigh`; and `gpt-5.1-codex-mini` only surfaces `medium` and `high`.
  - Per OpenAI API docs, `none` is supported for GPT‑5.1+ reasoning models (and is the default for `gpt-5.1`). Models before GPT‑5.1 default to `medium` and reject `none`. Older GPT‑5 slugs used `minimal`; this provider accepts both as aliases.
  - `xhigh` is exposed on codex-max models and newer model families that support it.
- **`reasoningSummary`** ('auto' | 'detailed'): Controls reasoning summary detail level. **Note:** Despite API error messages claiming 'concise' and 'none' are valid, they are rejected with 400 errors. Only 'auto' and 'detailed' work. Maps to `-c model_reasoning_summary=<value>`.
- **`reasoningSummaryFormat`** ('none' | 'experimental'): Controls reasoning summary format (experimental). Maps to `-c model_reasoning_summary_format=<value>`.
- **`modelVerbosity`** ('low' | 'medium' | 'high'): Controls output length/detail for GPT-5.1 **non-Codex** models (and legacy GPT-5). Codex-specific slugs (`gpt-5.1-codex`, `gpt-5.1-codex-mini`) ignore this, because the CLI disables verbosity for those model families (`codex-rs/core/src/model_family.rs`). Maps to `-c model_verbosity=<value>` when supported.

### Advanced Codex Features

- **`profile`** (string): Configuration profile from config.toml to specify default options. Maps to `--profile <name>`.
- **`oss`** (boolean): Use OSS provider (experimental). Maps to `--oss`.
- **`webSearch`** (boolean): Enable web search tool for the model. Maps to `-c tools.web_search=true`.

### MCP Servers (v0.6.0+)

- **`rmcpClient`** (boolean): Enables the RMCP client for HTTP-based MCP servers. Maps to `-c features.rmcp_client=true`.
- **`mcpServers`** (Record<string, McpServerConfig>): Define MCP servers by name.
  - Common fields: `enabled?`, `startupTimeoutSec?`, `toolTimeoutSec?`, `enabledTools?`, `disabledTools?`.
  - **Stdio servers** (`transport: 'stdio'`): `command` (required), `args?`, `env?`, `cwd?`.
  - **HTTP/RMCP servers** (`transport: 'http'`): `url` (required), `bearerToken?`, `bearerTokenEnvVar?`, `httpHeaders?`, `envHttpHeaders?`.

Example:

```ts
const model = codexCli('gpt-5.1-codex', {
  rmcpClient: true,
  mcpServers: {
    // Stdio MCP
    repo: {
      transport: 'stdio',
      command: 'node',
      args: ['tools/repo-mcp.js'],
      env: { API_KEY: process.env.REPO_KEY ?? '' },
      enabledTools: ['list', 'read'],
    },
    // HTTP/RMCP
    docs: {
      transport: 'http',
      url: 'https://mcp.internal/api',
      bearerTokenEnvVar: 'MCP_BEARER',
      httpHeaders: { 'x-tenant': 'acme' },
    },
  },
});
```

### Generic Config Overrides

- **`configOverrides`** (Record<string, string | number | boolean | object>): Generic Codex CLI config overrides. Allows setting any config value without updating the provider. Each entry maps to `-c <key>=<value>`.

Examples (nested objects are flattened to dotted keys):

```typescript
{
  experimental_resume: '/tmp/session.jsonl',           // string
  hide_agent_reasoning: true,                          // boolean
  model_context_window: 200000,                        // number
  sandbox_workspace_write: { network_access: true },   // object → -c sandbox_workspace_write.network_access=true
  'model_providers.custom.base_url': 'http://localhost:8000'  // nested config path
}
```

Values are serialized:

- string → raw string
- number/boolean → String(value)
- object → flattened to dotted keys (recursively)
- array → JSON.stringify(value)
- non-plain objects (Date, RegExp, Map, etc.) → JSON.stringify(value)

### Per-call Overrides (`providerOptions`, v0.4.0+)

Use AI SDK `providerOptions` to override Codex parameters for a single request without modifying the
model instance. The provider parses the `codex-cli` entry and applies the keys below:

- `reasoningEffort` → `model_reasoning_effort`
- `reasoningSummary` → `model_reasoning_summary`
- `reasoningSummaryFormat` → `model_reasoning_summary_format`
- `textVerbosity` → `model_verbosity` (AI SDK naming; mirrors constructor `modelVerbosity`)
- `addDirs` → appends `--add-dir` entries (merged with constructor `addDirs`)
- `configOverrides` → merged with constructor-level overrides (per-call values win on key conflicts)
- `mcpServers` → merged with constructor-level MCP servers (per-call values override per server)
- `rmcpClient` → overrides constructor `rmcpClient`

```ts
import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5.1', {
  reasoningEffort: 'medium',
  modelVerbosity: 'medium',
});

await generateText({
  model,
  prompt: 'Compare the trade-offs of high vs. low verbosity.',
  providerOptions: {
    'codex-cli': {
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
      textVerbosity: 'high',
      configOverrides: {
        'sandbox_workspace_write.network_access': true,
      },
    },
  },
});
```

**Precedence:** `providerOptions['codex-cli']` > constructor `CodexCliSettings` > Codex CLI defaults.

## Defaults & Recommendations

- Non‑interactive defaults:
  - `approvalMode: 'on-failure'`
  - `sandboxMode: 'workspace-write'`
  - `skipGitRepoCheck: true`
- For strict automation in controlled environments:
  - `fullAuto: true` OR `dangerouslyBypassApprovalsAndSandbox: true` (be careful!)

## Flag Mapping

### Core Settings

- `approvalMode` → `-c approval_policy=<mode>`
- `sandboxMode` → `-c sandbox_mode=<mode>`
- `skipGitRepoCheck` → `--skip-git-repo-check`
- `fullAuto` → `--full-auto`
- `dangerouslyBypassApprovalsAndSandbox` → `--dangerously-bypass-approvals-and-sandbox`
- `color` → `--color <always|never|auto>`
- `outputLastMessageFile` → `--output-last-message <path>`
- `addDirs` → `--add-dir <path>` (emitted once per entry)

### Model Parameters (v0.4.0+)

- `reasoningEffort` → `-c model_reasoning_effort=<value>`
- `reasoningSummary` → `-c model_reasoning_summary=<value>`
- `reasoningSummaryFormat` → `-c model_reasoning_summary_format=<value>`
- `modelVerbosity` → `-c model_verbosity=<value>`
- `profile` → `--profile <name>`
- `oss` → `--oss`
- `webSearch` → `-c tools.web_search=true`
- `configOverrides` → `-c <key>=<value>` (for each entry)

### MCP

- `rmcpClient` → `-c features.rmcp_client=true`
- `mcpServers` → `-c mcp_servers.<name>.<field>=<value>` for each field (e.g., `command`, `args`, `env.KEY`, `url`, `bearer_token_env_var`, `http_headers.Header-Name`).

## JSON Mode (v0.2.0+)

When the AI SDK request uses `responseFormat: { type: 'json' }`, the provider:

1. Converts your Zod schema to JSON Schema format
2. Sanitizes the schema (removes unsupported fields like `format`, `pattern`, `$schema`, etc.)
3. Passes the schema via `--output-schema` for native OpenAI strict mode enforcement
4. The API returns guaranteed valid JSON matching your schema
5. AI SDK validates the response with Zod

**Breaking change from v0.1.x**: No longer uses prompt engineering. Schemas are enforced at the API level using OpenAI strict mode, which does not support optional fields or format validators.

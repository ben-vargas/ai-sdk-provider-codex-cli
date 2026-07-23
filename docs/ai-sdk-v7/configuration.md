# Configuration Reference

This package ships two provider modes:

- **`codexExec`** wraps the `codex exec` CLI in non‑interactive mode and maps settings to CLI flags/config overrides. Per-call overrides use `providerOptions['codex-cli']`.
- **`codexAppServer`** speaks JSON-RPC to a persistent `codex app-server` process. Per-call overrides use `providerOptions['codex-app-server']`.

Model IDs are discovered, not hard-coded: use `listModels()` / `provider.listModels()` (see [guide.md](./guide.md#discovering-models)). Examples below use `gpt-5.5` as a placeholder.

## Exec Provider Settings (`codexExec`)

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

### Reasoning & Verbosity

- **`reasoningEffort`** ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): Controls reasoning depth for reasoning-capable models. Higher effort produces more thorough reasoning at the cost of latency. Maps to `-c model_reasoning_effort=<value>`.
  - Which effort levels a given model accepts is owned by Codex/OpenAI and varies by model family; check your Codex CLI docs for the models `listModels()` returns.
  - `'none'` is the "no extra reasoning" level for newer model families; `'minimal'` is retained as a backwards-compatible alias used by older GPT‑5 slugs.
  - `'xhigh'` is only exposed on model families that support it.
  - The AI SDK v7 top-level `reasoning` call option maps onto this setting — see [Reasoning Precedence](#reasoning-precedence).
- **`reasoningSummary`** ('auto' | 'detailed'): Controls reasoning summary detail level. **Note:** Despite API error messages claiming 'concise' and 'none' are valid, they are rejected with 400 errors. Only 'auto' and 'detailed' work. Maps to `-c model_reasoning_summary=<value>`.
- **`reasoningSummaryFormat`** ('none' | 'experimental'): Controls reasoning summary format (experimental). Maps to `-c model_reasoning_summary_format=<value>`.
- **`modelVerbosity`** ('low' | 'medium' | 'high'): Controls output length/detail for models that support `model_verbosity`; Codex-specific slugs ignore it (the CLI disables verbosity for those model families). Maps to `-c model_verbosity=<value>`.

### Advanced Codex Features

- **`profile`** (string): Configuration profile from config.toml to specify default options. Maps to `--profile <name>`.
- **`oss`** (boolean): Use OSS provider (experimental). Maps to `--oss`.
- **`webSearch`** (boolean): Enable web search tool for the model. Maps to `-c tools.web_search=true`.

### MCP Servers

- **`rmcpClient`** (boolean): Enables the RMCP client for HTTP-based MCP servers. Maps to `-c features.rmcp_client=true`.
- **`mcpServers`** (Record<string, McpServerConfig>): Define MCP servers by name.
  - Common fields: `enabled?`, `startupTimeoutSec?`, `toolTimeoutSec?`, `enabledTools?`, `disabledTools?`.
  - **Stdio servers** (`transport: 'stdio'`): `command` (required), `args?`, `env?`, `cwd?`.
  - **HTTP/RMCP servers** (`transport: 'http'`): `url` (required), `bearerToken?`, `bearerTokenEnvVar?`, `httpHeaders?`, `envHttpHeaders?`.

Auth notes for HTTP servers:

- Prefer `bearerTokenEnvVar` (the name of an environment variable holding the token) over an inline `bearerToken`.
- With the exec provider, an inline `bearerToken` is never placed on the codex command line: the provider passes it to the spawned process through a synthesized environment variable (`CODEX_MCP_<NAME>_BEARER_TOKEN`) and emits `bearer_token_env_var` pointing at it, so the secret is not visible in `ps` output or `/proc/<pid>/cmdline`.
- If both `bearerToken` and `bearerTokenEnvVar` are set, `bearerTokenEnvVar` wins and the inline token is ignored (a warning is logged).
- An explicit `Authorization` key in `httpHeaders` takes precedence over `bearerToken`. Note that `httpHeaders` values are passed as `-c` arguments on the exec provider's command line — put secrets in `bearerTokenEnvVar` or `envHttpHeaders` instead of `httpHeaders`.

Example:

```ts
const model = codexExec('gpt-5.5', {
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

The app-server provider additionally accepts in-process SDK MCP servers created with `createSdkMcpServer()` / `tool()` as `mcpServers` values.

### Generic Config Overrides

- **`configOverrides`** (Record<string, string | number | boolean | object>): Generic Codex CLI config overrides. Allows setting any config value without updating the provider. Each entry maps to `-c <key>=<value>`.

Examples (nested objects are flattened to dotted keys):

```ts
const overrides = {
  experimental_resume: '/tmp/session.jsonl', // string
  hide_agent_reasoning: true, // boolean
  model_context_window: 200000, // number
  sandbox_workspace_write: { network_access: true }, // object → -c sandbox_workspace_write.network_access=true
  'model_providers.custom.base_url': 'http://localhost:8000', // nested config path
};
```

Values are serialized:

- string → raw string
- number/boolean → String(value)
- object → flattened to dotted keys (recursively)
- array → JSON.stringify(value)
- non-plain objects (Date, RegExp, Map, etc.) → JSON.stringify(value)

### Per-call Overrides (`providerOptions['codex-cli']`)

Use AI SDK `providerOptions` to override Codex parameters for a single request without modifying the model instance. The provider parses the `codex-cli` entry and applies the keys below:

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
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.5', {
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

**Precedence:** `providerOptions['codex-cli']` > constructor `CodexExecSettings` > Codex CLI defaults.

### Flag Mapping

#### Core Settings

- `approvalMode` → `-c approval_policy=<mode>`
- `sandboxMode` → `-c sandbox_mode=<mode>`
- `skipGitRepoCheck` → `--skip-git-repo-check`
- `fullAuto` → `--full-auto`
- `dangerouslyBypassApprovalsAndSandbox` → `--dangerously-bypass-approvals-and-sandbox`
- `color` → `--color <always|never|auto>`
- `outputLastMessageFile` → `--output-last-message <path>`
- `addDirs` → `--add-dir <path>` (emitted once per entry)

#### Model Parameters

- `reasoningEffort` → `-c model_reasoning_effort=<value>`
- `reasoningSummary` → `-c model_reasoning_summary=<value>`
- `reasoningSummaryFormat` → `-c model_reasoning_summary_format=<value>`
- `modelVerbosity` → `-c model_verbosity=<value>`
- `profile` → `--profile <name>`
- `oss` → `--oss`
- `webSearch` → `-c tools.web_search=true`
- `configOverrides` → `-c <key>=<value>` (for each entry)

#### MCP

- `rmcpClient` → `-c features.rmcp_client=true`
- `mcpServers` → `-c mcp_servers.<name>.<field>=<value>` for each field (e.g., `command`, `args`, `env.KEY`, `url`, `bearer_token_env_var`, `http_headers.Header-Name`).

## App-Server Settings

`createCodexAppServer({ defaultSettings })` and the per-model settings argument accept:

**Process & connection**

- `codexPath` (string): Explicit Codex CLI path, bypassing PATH resolution.
- `cwd` (string): Working directory for the app-server process.
- `env` (Record<string,string>): Extra env vars for the child process.
- `connectionTimeoutMs` (number): `initialize` handshake timeout.
- `requestTimeoutMs` (number): Default per-request JSON-RPC timeout.
- `idleTimeoutMs` (number): Close an idle app-server process after inactivity.
- `minCodexVersion` (string): Minimum supported app-server version (semver); the provider fails fast when the CLI is older.
- `verbose` / `logger`: Same logging contract as exec mode.

**Turn behavior**

- `personality` ('none' | 'friendly' | 'pragmatic'): Codex response personality.
- `effort` ('none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'): Reasoning effort for the turn; see [Reasoning Precedence](#reasoning-precedence).
- `summary` ('auto' | 'concise' | 'detailed' | 'none'): Reasoning summary level (app-server protocol accepts all four).
- `approvalPolicy`: 'untrusted' | 'on-failure' | 'on-request' | 'never' or a protocol-shaped object.
- `sandboxPolicy`: 'read-only' | 'workspace-write' | 'danger-full-access' or a protocol-shaped object (e.g. `{ type: 'externalSandbox', networkAccess: 'enabled' }`).
- `baseInstructions` / `developerInstructions` (string): Instruction overrides passed to the thread.

**MCP & config**

- `mcpServers` (Record<string, McpServerConfig | SdkMcpServer>): Stdio/HTTP MCP servers, or in-process SDK MCP servers from `createSdkMcpServer()`.
- `rmcpClient` (boolean): Enable HTTP-based MCP clients.
- `configOverrides`: Same shape and serialization as exec mode.

**Sessions & streaming**

- `threadMode` ('stateless' | 'persistent'): `stateless` (default) starts an ephemeral thread per call; `persistent` reuses one thread automatically.
- `resume` (string): Shorthand to resume an existing thread id.
- `persistExtendedHistory` (boolean): Request extended thread history persistence.
- `includeRawChunks` (boolean): Emit raw JSON-RPC notifications as `raw` stream parts by default.
- `onSessionCreated` (callback): Receives a live session object exposing `injectMessage()` and `interrupt()`.

**Approvals**

- `autoApprove` (boolean): Default approval response when no custom handler is provided (covers command execution, file changes, skills, and MCP tool call elicitations).
- `serverRequests` (CodexAppServerRequestHandlers): Typed handlers for server-initiated JSON-RPC requests (command approvals, file-change approvals, skill approvals, MCP elicitations, dynamic tool calls, auth refresh, plus an `unhandled` fallback).

### Per-call Overrides (`providerOptions['codex-app-server']`)

Per-call keys mirror the settings above: `threadId`, `resume`, `threadMode`, `includeRawChunks`, `personality`, `effort`, `summary`, `approvalPolicy`, `sandboxPolicy`, `baseInstructions`, `developerInstructions`, `mcpServers`, `rmcpClient`, `configOverrides`, `autoApprove`, `persistExtendedHistory`, `serverRequests`, `onSessionCreated`.

```ts
import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer();

const response = await generateText({
  model: provider('gpt-5.5'),
  prompt: 'Continue this task.',
  providerOptions: {
    'codex-app-server': {
      threadId: 'thr_existing',
      personality: 'pragmatic',
      approvalPolicy: 'on-request',
      effort: 'high',
    },
  },
});

await provider.close();
```

**Precedence:** `providerOptions['codex-app-server']` > model/constructor `CodexAppServerSettings` > Codex defaults.

Always call `provider.close()` (alias `dispose()`) when you are done; the app-server process is shared across calls and does not exit on its own before `idleTimeoutMs`.

### Model Discovery

- `listModels(options?)` — standalone helper; spins up a temporary app-server process. Options: `codexPath`, `env`, `cwd`, `minCodexVersion`, `modelProviders`, `connectionTimeoutMs`, `requestTimeoutMs`. Returns `{ models, defaultModel, nextCursor }`.
- `provider.listModels(modelProviders?)` — queries through the provider's existing client process.

## Reasoning Precedence

AI SDK v7 adds a provider-agnostic top-level call option:

```ts
reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
```

This provider maps it to Codex reasoning effort. The exact precedence, highest first:

**Exec (`codexCli` / `codexExec`):**

1. `providerOptions['codex-cli'].reasoningEffort`
2. top-level `reasoning` (when it is not `'provider-default'`)
3. constructor `reasoningEffort` setting
4. Codex CLI default

**App-server (`codexAppServer`):**

1. `providerOptions['codex-app-server'].effort`
2. top-level `reasoning` (when it is not `'provider-default'`)
3. constructor/model `effort` setting
4. Codex default

Notes:

- `reasoning: 'provider-default'` (or omitting the option) falls through to your provider-specific configuration — the provider does not send an effort override on your behalf.
- If both the top-level option and a provider-specific option are set, the provider-specific value silently wins. When migrating to the top-level `reasoning` option, remove overlapping `reasoningEffort` / `effort` entries from `providerOptions` so your new configuration actually applies.
- All current v7 `reasoning` values map 1:1 onto Codex effort levels. If a future AI SDK adds a value Codex does not understand, the provider emits an `unsupported` warning instead of failing the call.

```ts
await generateText({
  model: provider('gpt-5.5'),
  reasoning: 'low', // ignored in favor of providerOptions below
  prompt: 'Quick sanity check.',
  providerOptions: {
    'codex-app-server': { effort: 'high' }, // wins
  },
});
```

## Defaults & Recommendations

- Non‑interactive defaults (exec):
  - `approvalMode: 'on-failure'`
  - `sandboxMode: 'workspace-write'`
  - `skipGitRepoCheck: true`
- For strict automation in controlled environments:
  - `fullAuto: true` OR `dangerouslyBypassApprovalsAndSandbox: true` (be careful!)
- App-server: set `minCodexVersion` to the Codex CLI version you validated against, and always `await provider.close()`.

## JSON Mode

When the AI SDK request uses `responseFormat: { type: 'json' }` (as `generateObject` / `streamObject` do), the provider:

1. Converts your Zod schema to JSON Schema format
2. Sanitizes the schema (removes unsupported fields like `format`, `pattern`, `$schema`, etc.)
3. Passes the schema via `--output-schema` (exec) or `outputSchema` (app-server) for native OpenAI strict mode enforcement
4. The API returns guaranteed valid JSON matching your schema
5. AI SDK validates the response with Zod

OpenAI strict mode does not support optional fields or format validators — see [limitations.md](./limitations.md).

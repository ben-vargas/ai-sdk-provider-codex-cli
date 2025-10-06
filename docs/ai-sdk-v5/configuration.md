# Configuration Reference

This provider wraps the `codex exec` CLI in non‑interactive mode and maps settings to CLI flags/config overrides.

## Settings

- `allowNpx` (boolean): If true, runs `npx -y @openai/codex` when Codex isn’t found on PATH.
- `codexPath` (string): Explicit path to Codex JS entry (`bin/codex.js`), bypassing PATH resolution.
- `cwd` (string): Working directory for the spawned process.
- `color` ('always' | 'never' | 'auto'): Controls ANSI color emission.
- `skipGitRepoCheck` (boolean): When true, passes `--skip-git-repo-check`.
- `fullAuto` (boolean): Sets `--full-auto` (low-friction sandboxed execution).
- `dangerouslyBypassApprovalsAndSandbox` (boolean): Maps to `--dangerously-bypass-approvals-and-sandbox`.
- `approvalMode` ('untrusted' | 'on-failure' | 'on-request' | 'never'): Applied via `-c approval_policy=...`.
- `sandboxMode` ('read-only' | 'workspace-write' | 'danger-full-access'): Applied via `-c sandbox_mode=...`.
- `outputLastMessageFile` (string): File path to write the last agent message. If omitted, a temp file is created.
- `env` (Record<string,string>): Extra env vars for the child process (e.g., `OPENAI_API_KEY`).
- `logger` (custom | false): Custom logger or disable logging entirely.

## Model Parameters & Advanced Options (v0.4.0+)

### Reasoning & Verbosity

- **`reasoningEffort`** ('minimal' | 'low' | 'medium' | 'high'): Controls reasoning depth for reasoning-capable models (o3, o4-mini, gpt-5, gpt-5-codex). Higher effort produces more thorough reasoning at the cost of latency. Maps to `-c model_reasoning_effort=<value>`.
- **`reasoningSummary`** ('auto' | 'detailed'): Controls reasoning summary detail level. **Note:** Despite API error messages claiming 'concise' and 'none' are valid, they are rejected with 400 errors. Only 'auto' and 'detailed' work. Maps to `-c model_reasoning_summary=<value>`.
- **`reasoningSummaryFormat`** ('none' | 'experimental'): Controls reasoning summary format (experimental). Maps to `-c model_reasoning_summary_format=<value>`.
- **`modelVerbosity`** ('low' | 'medium' | 'high'): Controls output length/detail for GPT-5 family models. Only applies to models using the Responses API. Maps to `-c model_verbosity=<value>`.

### Advanced Codex Features

- **`includePlanTool`** (boolean): Include experimental plan tool that the model can use to update its current plan. Maps to `--include-plan-tool`.
- **`profile`** (string): Configuration profile from config.toml to specify default options. Maps to `--profile <name>`.
- **`oss`** (boolean): Use OSS provider (experimental). Maps to `--oss`.
- **`webSearch`** (boolean): Enable web search tool for the model. Maps to `-c tools.web_search=true`.

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
- `configOverrides` → merged with constructor-level overrides (per-call values win on key conflicts)

```ts
import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5-codex', {
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

### Model Parameters (v0.4.0+)

- `reasoningEffort` → `-c model_reasoning_effort=<value>`
- `reasoningSummary` → `-c model_reasoning_summary=<value>`
- `reasoningSummaryFormat` → `-c model_reasoning_summary_format=<value>`
- `modelVerbosity` → `-c model_verbosity=<value>`
- `includePlanTool` → `--include-plan-tool`
- `profile` → `--profile <name>`
- `oss` → `--oss`
- `webSearch` → `-c tools.web_search=true`
- `configOverrides` → `-c <key>=<value>` (for each entry)

## JSON Mode (v0.2.0+)

When the AI SDK request uses `responseFormat: { type: 'json' }`, the provider:

1. Converts your Zod schema to JSON Schema format
2. Sanitizes the schema (removes unsupported fields like `format`, `pattern`, `$schema`, etc.)
3. Passes the schema via `--output-schema` for native OpenAI strict mode enforcement
4. The API returns guaranteed valid JSON matching your schema
5. AI SDK validates the response with Zod

**Breaking change from v0.1.x**: No longer uses prompt engineering. Schemas are enforced at the API level using OpenAI strict mode, which does not support optional fields or format validators.

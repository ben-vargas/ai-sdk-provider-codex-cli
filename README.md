# AI SDK Provider for Codex CLI

[![npm version](https://img.shields.io/npm/v/ai-sdk-provider-codex-cli.svg)](https://www.npmjs.com/package/ai-sdk-provider-codex-cli)
[![npm downloads](https://img.shields.io/npm/dm/ai-sdk-provider-codex-cli.svg)](https://www.npmjs.com/package/ai-sdk-provider-codex-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-43853d?logo=node.js&logoColor=white)
![AI SDK v6](https://img.shields.io/badge/AI%20SDK-v6-000?logo=vercel&logoColor=white)
![Modules: ESM + CJS](https://img.shields.io/badge/modules-ESM%20%2B%20CJS-3178c6)
![TypeScript](https://img.shields.io/badge/TypeScript-blue)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/issues)
[![Latest Release](https://img.shields.io/github/v/release/ben-vargas/ai-sdk-provider-codex-cli?display_name=tag)](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/releases/latest)

A community provider for Vercel AI SDK v6 that integrates OpenAI's Codex CLI with GPT‑5.1 / GPT‑5.2 class models (`gpt-5.1`, `gpt-5.2`, the Codex-specific `gpt-5.3-codex` / `gpt-5.2-codex`, the flagship `*-codex-max`, and the lightweight `*-codex-mini` slugs) using your ChatGPT Plus/Pro subscription.

This package ships two provider modes:

- `codexExec`: non-interactive `codex exec` (spawn a new process per call)
- `codexAppServer`: persistent `codex app-server` JSON-RPC client (shared process, true delta streaming, optional stateful threads)

- Works with `generateText`, `streamText`, and `generateObject`
- Uses ChatGPT OAuth from `codex login` (tokens in `~/.codex/auth.json`) or `OPENAI_API_KEY`
- Node-only (spawns a local process); supports CI and local dev
- **v1.0.0**: AI SDK v6 stable migration with LanguageModelV3 interface
- **v0.5.0**: Adds comprehensive logging system with verbose mode and custom logger support
- **v0.3.0**: Adds comprehensive tool streaming support for monitoring autonomous tool execution

## Version Compatibility

| Provider Version | AI SDK Version | NPM Tag     | NPM Installation                                      |
| ---------------- | -------------- | ----------- | ----------------------------------------------------- |
| 1.x.x            | v6             | `latest`    | `npm i ai-sdk-provider-codex-cli ai@^6.0.0`           |
| 0.x.x            | v5             | `ai-sdk-v5` | `npm i ai-sdk-provider-codex-cli@ai-sdk-v5 ai@^5.0.0` |

## Installation

### For AI SDK v6 (default)

1. Install and authenticate Codex CLI

```bash
npm i -g @openai/codex
codex login   # or set OPENAI_API_KEY
```

2. Install provider and AI SDK v6

```bash
npm i ai ai-sdk-provider-codex-cli
```

### For AI SDK v5

```bash
npm i ai@^5.0.0 ai-sdk-provider-codex-cli@ai-sdk-v5
```

> **⚠️ Codex CLI Version**: Requires Codex CLI **>= 0.105.0** for full support of both provider modes (`codexExec` and `codexAppServer`). If you supply your own Codex CLI (global install or custom `codexPath`), check it with `codex --version` and upgrade if needed. The optional dependency `@openai/codex` in this package pulls a compatible version automatically.
>
> ```bash
> npm i -g @openai/codex@latest
> ```

## Quick Start

### Exec provider (`codexExec`) — process-per-call

```js
import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
});

const { text } = await generateText({
  model,
  prompt: 'Reply with a single word: hello.',
});
console.log(text);
```

### App-server provider (`createCodexAppServer`) — persistent process

```js
import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.105.0',
    autoApprove: false,
    personality: 'pragmatic',
  },
});

const { textStream } = await streamText({
  model: provider('gpt-5.3-codex'),
  prompt: 'Write two short lines of encouragement.',
});
for await (const chunk of textStream) process.stdout.write(chunk);

await provider.close();
```

### App-server stateful threads (optional)

By default, `codexAppServer` is stateless (new ephemeral thread per call). To continue a prior conversation, pass `threadId` in `providerOptions['codex-app-server']`.

```js
import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer();

const first = await generateText({
  model: provider('gpt-5.3-codex'),
  prompt: 'Start a migration checklist.',
});

const threadId = first.providerMetadata?.['codex-app-server']?.threadId;

const second = await generateText({
  model: provider('gpt-5.3-codex'),
  prompt: 'Continue from step 2.',
  providerOptions: {
    'codex-app-server': { threadId },
  },
});

await provider.close();
```

### Object generation (Zod)

```js
import { generateObject } from 'ai';
import { z } from 'zod';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const schema = z.object({ name: z.string(), age: z.number().int() });
const { object } = await generateObject({
  model: codexExec('gpt-5.3-codex', { allowNpx: true, skipGitRepoCheck: true }),
  schema,
  prompt: 'Generate a small user profile.',
});
console.log(object);
```

## Features

- AI SDK v6 compatible (LanguageModelV3)
- Dual provider architecture:
  - `codexExec` / `createCodexExec` for `codex exec`
  - `codexAppServer` / `createCodexAppServer` for `codex app-server`
- Backward-compatible aliases: `codexCli` / `createCodexCli` map to exec mode
- Streaming and non‑streaming
- **Configurable logging** (v0.5.0+) - Verbose mode, custom loggers, or silent operation
- **Tool streaming support** (v0.3.0+) - Monitor autonomous tool execution in real-time
- **Native JSON Schema support** via `--output-schema` (API-enforced with `strict: true`)
- JSON object generation with Zod schemas (100-200 fewer tokens per request vs prompt engineering)
- Safe defaults for non‑interactive automation (`on-failure`, `workspace-write`, `--skip-git-repo-check`)
- Fallback to `npx @openai/codex` when not on PATH (`allowNpx`)
- Usage tracking from experimental JSON event format
- **Image support** - Local binary images in both providers, plus remote HTTP/HTTPS image URLs in app-server mode

### Image Support

The provider supports multimodal (image) inputs for vision-capable models:

```js
import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';
import { readFileSync } from 'fs';

const model = codexExec('gpt-5.3-codex', { allowNpx: true, skipGitRepoCheck: true });
const imageBuffer = readFileSync('./screenshot.png');

const { text } = await generateText({
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What do you see in this image?' },
        { type: 'image', image: imageBuffer, mimeType: 'image/png' },
      ],
    },
  ],
});
console.log(text);
```

**Supported image formats:**

- Base64 data URL (`data:image/png;base64,...`)
- Base64 string (without data URL prefix)
- `Buffer` / `Uint8Array` / `ArrayBuffer`

**Remote image URLs:**

- `codexExec` mode: HTTP/HTTPS image URLs are not supported (provide binary/image data)
- `codexAppServer` mode: HTTP/HTTPS image URLs are supported and forwarded to app-server as remote image inputs

Local image data is written to temporary files and passed to Codex CLI via `--image` (or app-server `localImage`). Temp files are automatically cleaned up after each request.

See [examples/exec/image-support.mjs](examples/exec/image-support.mjs) and [examples/app-server/image-support.mjs](examples/app-server/image-support.mjs) for complete working examples.

### Tool Streaming (v0.3.0+)

The provider supports comprehensive tool streaming, enabling real-time monitoring of Codex CLI's autonomous tool execution:

```js
import { streamText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const result = await streamText({
  model: codexExec('gpt-5.3-codex', { allowNpx: true, skipGitRepoCheck: true }),
  prompt: 'List files and count lines in the largest one',
});

for await (const part of result.fullStream) {
  if (part.type === 'tool-call') {
    console.log('🔧 Tool:', part.toolName);
  }
  if (part.type === 'tool-result') {
    console.log('✅ Result:', part.result);
  }
}
```

**What you get:**

- Tool invocation events when Codex starts executing tools (exec, patch, web_search, mcp_tool_call)
- Tool input tracking with full parameter visibility
- Tool result events with complete output payloads
- `providerExecuted: true` on all tool calls (Codex executes autonomously, app doesn't need to)

**Current behavior:**

- `codexExec`: tool outputs are delivered in final `tool-result` events.
- `codexAppServer`: when Codex emits tool output delta notifications, the provider surfaces `tool-result` parts with `result.type === 'output-delta'` during streaming.

See `examples/exec/streaming-tool-calls.mjs`, `examples/exec/streaming-multiple-tools.mjs`, and their app-server counterparts under `examples/app-server/`.

### Logging Configuration (v0.5.0+)

Control logging verbosity and integrate with your observability stack:

```js
import { codexExec } from 'ai-sdk-provider-codex-cli';

// Default: warn/error only (clean production output)
const model = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
});

// Verbose mode: enable debug/info logs for troubleshooting
const verboseModel = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  verbose: true, // Shows all log levels
});

// Custom logger: integrate with Winston, Pino, Datadog, etc.
const customModel = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  verbose: true,
  logger: {
    debug: (msg) => myLogger.debug('Codex:', msg),
    info: (msg) => myLogger.info('Codex:', msg),
    warn: (msg) => myLogger.warn('Codex:', msg),
    error: (msg) => myLogger.error('Codex:', msg),
  },
});

// Silent: disable all logging
const silentModel = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  logger: false, // No logs at all
});
```

**Log Levels:**

- `debug`: Detailed execution traces (verbose mode only)
- `info`: General execution flow (verbose mode only)
- `warn`: Warnings and misconfigurations (always shown)
- `error`: Errors and failures (always shown)

**Default Logger:** Adds level tags `[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]` to console output. Use a custom logger or `logger: false` if you need different formatting.

See `examples/exec/logging-*.mjs` and `examples/app-server/logging-*.mjs` for complete examples, and [docs/ai-sdk-v5/guide.md](docs/ai-sdk-v5/guide.md) for detailed configuration.

### Text Streaming behavior

**`codexExec` mode:** Incremental streaming is not currently available with `codex exec --experimental-json`.

The `--experimental-json` output format (introduced Sept 25, 2025) currently only emits `item.completed` events with full text content. Incremental streaming via `item.updated` or delta events is not yet implemented by OpenAI.

**What this means in exec mode:**

- `streamText()` works functionally but delivers the entire response in a single chunk after generation completes
- No incremental text deltas—you wait for the full response, then receive it all at once
- The AI SDK's streaming interface is supported, but actual incremental streaming is not available

**`codexAppServer` mode:** supports true incremental text deltas via `item/agentMessage/delta`, so `streamText()` emits progressively as tokens arrive.

When OpenAI adds streaming support to `codex exec --experimental-json`, this provider will surface those deltas in exec mode as well.

## Documentation

- Getting started, configuration, and troubleshooting live in `docs/`:
  - [docs/ai-sdk-v5/guide.md](docs/ai-sdk-v5/guide.md) – full usage guide and examples
  - [docs/ai-sdk-v5/configuration.md](docs/ai-sdk-v5/configuration.md) – all settings and how they map to CLI flags
  - [docs/ai-sdk-v5/troubleshooting.md](docs/ai-sdk-v5/troubleshooting.md) – common issues and fixes
  - [docs/ai-sdk-v5/limitations.md](docs/ai-sdk-v5/limitations.md) – known constraints and behavior differences
  - [docs/ai-sdk-v5/migration-app-server-v2.md](docs/ai-sdk-v5/migration-app-server-v2.md) – app-server v2 migration notes
- See [examples/](examples/) for runnable scripts covering core usage, streaming, permissions/sandboxing, and object generation.
- Validation helpers:
  - `npm run validate:docs` checks markdown links and example command paths
  - `npm run validate:examples:app-server` runs all app-server examples with intent checks
  - `npm run validate:full` runs build/type/lint/test plus docs and app-server example validation

## Authentication

- Preferred: ChatGPT OAuth via `codex login` (stores tokens at `~/.codex/auth.json`)
- Alternative: export `OPENAI_API_KEY` in the provider’s `env` settings (forwarded to the spawned process)

## Configuration (high level)

- `allowNpx`: If true, falls back to `npx -y @openai/codex` when Codex is not on PATH
- `cwd`: Working directory for Codex
- `addDirs`: Extra directories Codex may read/write (repeats `--add-dir`)
- Autonomy/sandbox:
  - `fullAuto` (equivalent to `--full-auto`)
  - `dangerouslyBypassApprovalsAndSandbox` (bypass approvals and sandbox; dangerous)
  - Otherwise the provider writes `-c approval_policy=...` and `-c sandbox_mode=...` for you; defaults to `on-failure` and `workspace-write`
- `skipGitRepoCheck`: enable by default for CI/non‑repo contexts
- `color`: `always` | `never` | `auto`
- `outputLastMessageFile`: by default the provider sets a temp path and reads it to capture final text reliably
- Logging (v0.5.0+):
  - `verbose`: Enable debug/info logs (default: `false` for clean output)
  - `logger`: Custom logger object or `false` to disable all logging

See [docs/ai-sdk-v5/configuration.md](docs/ai-sdk-v5/configuration.md) for the full list and examples.

### App-server settings highlights

`createCodexAppServer({ defaultSettings })` accepts app-server specific options:

- `connectionTimeoutMs`: initialize handshake timeout
- `requestTimeoutMs`: default per-request JSON-RPC timeout
- `idleTimeoutMs`: close idle app-server process after inactivity
- `minCodexVersion`: minimum supported app-server version (semver)
- `includeRawChunks`: emit raw JSON-RPC notifications as `raw` stream parts by default
- `serverRequests`: typed handlers for server-initiated JSON-RPC requests
- `autoApprove`: default approval response when no custom handler is provided
- `persistExtendedHistory`: request extended thread history persistence
- `threadMode`: `stateless` (default) or `persistent` automatic thread reuse
- `resume`: shorthand to resume an existing thread id
- `onSessionCreated`: receive a session object for `injectMessage()` / `interrupt()`

Per-call app-server overrides use `providerOptions['codex-app-server']` (for example `threadId`, `threadMode`, `includeRawChunks`, `personality`, `approvalPolicy`, `sandboxPolicy`, `serverRequests`, `configOverrides`).

Additional app-server helpers:

- `listModels()`: query available models via a temporary app-server process (or use `provider.listModels()` to query through an existing provider/client)
- `tool()`, `createLocalMcpServer()`, `createSdkMcpServer()`: define and expose local MCP tools

Local MCP security defaults:

- `createLocalMcpServer()` binds to loopback hosts by default and rejects non-loopback `host` values unless you set `allowNonLoopbackHost: true`.
- `createLocalMcpServer()` generates a per-server bearer token and expects `Authorization: Bearer <token>` on direct HTTP calls. The token is available at `server.config.bearerToken`.
- `createSdkMcpServer()` propagates this auth config automatically, so provider-level MCP wiring works without extra manual headers.
- Without `cacheKey`, SDK MCP server/tool function identity participates in persistent keying to avoid conflating closure-dependent tool behavior.
- Use `createSdkMcpServer({ cacheKey })` when you intentionally recreate equivalent SDK MCP definitions per call and want stable persistent model reuse.

## Model Parameters & Advanced Options (v0.4.0+)

Control reasoning effort, verbosity, and advanced Codex features at model creation time:

```ts
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  addDirs: ['../shared'],

  // Reasoning & verbosity
  reasoningEffort: 'medium', // none | minimal | low | medium | high | xhigh (xhigh on codex-max and newer models that expose it)
  reasoningSummary: 'auto', // auto | detailed (Note: 'concise' and 'none' are rejected by API)
  reasoningSummaryFormat: 'none', // none | experimental
  modelVerbosity: 'high', // low | medium | high

  // Advanced features
  profile: 'production', // adds --profile production
  oss: false, // adds --oss when true
  webSearch: true, // maps to -c tools.web_search=true

  // MCP servers (stdio + HTTP/RMCP)
  rmcpClient: true, // enables HTTP-based MCP clients (features.rmcp_client=true)
  mcpServers: {
    local: {
      transport: 'stdio',
      command: 'node',
      args: ['tools/mcp.js'],
      env: { API_KEY: process.env.MCP_API_KEY ?? '' },
    },
    docs: {
      transport: 'http',
      url: 'https://mcp.my-org.com',
      bearerTokenEnvVar: 'MCP_BEARER',
      httpHeaders: { 'x-tenant': 'acme' },
    },
  },

  // Generic overrides (maps to -c key=value)
  configOverrides: {
    experimental_resume: '/tmp/session.jsonl',
    sandbox_workspace_write: { network_access: true },
  },
});
```

Nested override objects are flattened to dotted keys (e.g., the example above emits
`-c sandbox_workspace_write.network_access=true`). Arrays are serialized to JSON strings.
MCP server env/header objects flatten the same way (e.g., `mcp_servers.docs.http_headers.x-tenant=acme`).

### Per-call overrides via `providerOptions` (v0.4.0+)

Override these parameters for individual AI SDK calls using the `providerOptions` map. Per-call
values take precedence over constructor defaults while leaving other settings intact.

```ts
import { generateText } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const model = codexExec('gpt-5.3-codex', {
  allowNpx: true,
  reasoningEffort: 'medium',
  modelVerbosity: 'medium',
});

const response = await generateText({
  model,
  prompt: 'Summarize the latest release notes.',
  providerOptions: {
    'codex-cli': {
      reasoningEffort: 'high',
      reasoningSummary: 'detailed',
      textVerbosity: 'high', // AI SDK naming; maps to model_verbosity
      rmcpClient: true,
      mcpServers: {
        scratch: {
          transport: 'stdio',
          command: 'pnpm',
          args: ['mcp', 'serve'],
        },
      },
      configOverrides: {
        experimental_resume: '/tmp/resume.jsonl',
      },
    },
  },
});
```

**Precedence:** `providerOptions['codex-cli']` > constructor `CodexCliSettings` > Codex CLI defaults.

App-server per-call overrides use `providerOptions['codex-app-server']`:

```ts
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServerProvider = createCodexAppServer();

const response = await generateText({
  model: appServerProvider('gpt-5.3-codex'),
  prompt: 'Continue this task.',
  providerOptions: {
    'codex-app-server': {
      threadId: 'thr_existing',
      personality: 'pragmatic',
      approvalPolicy: 'on-request',
    },
  },
});
```

## Zod Compatibility

- Peer supports `zod@^3 || ^4`
- Validation logic normalizes v3/v4 error shapes

## Limitations

- Node ≥ 18, local process only (no Edge)
- Codex `--experimental-json` mode emits events rather than streaming deltas; streaming typically yields a final chunk. The CLI provides the final assistant text in the `item.completed` event, which this provider reads and emits at the end.
- Some AI SDK parameters are unsupported by Codex CLI (e.g., temperature/topP/penalties); the provider surfaces warnings and ignores them

### JSON Schema Limitations (v0.2.0+)

**⚠️ Important:** OpenAI strict mode has limitations:

- **Optional fields NOT supported**: All fields must be required (no `.optional()`)
- **Format validators stripped**: `.email()`, `.url()`, `.uuid()` are removed (use descriptions instead)
- **Pattern validators stripped**: `.regex()` is removed (use descriptions instead)

See [LIMITATIONS.md](LIMITATIONS.md) for comprehensive details and migration guidance.

## Disclaimer

This is a community provider and not an official OpenAI or Vercel product. You are responsible for complying with all applicable terms and ensuring safe usage.

## License

MIT

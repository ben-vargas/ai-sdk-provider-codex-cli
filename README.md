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

A community provider for Vercel AI SDK v6 that uses OpenAI's Codex CLI (non‑interactive `codex exec`) to talk to GPT‑5.1 / GPT‑5.2 class models (`gpt-5.1`, `gpt-5.2`, the Codex-specific `gpt-5.1-codex` / `gpt-5.2-codex`, the flagship `*-codex-max`, and the lightweight `*-codex-mini` slugs) with your ChatGPT Plus/Pro subscription. The provider spawns the Codex CLI process, parses its JSONL output, and adapts it to the AI SDK LanguageModelV3 interface. Legacy GPT-5 / GPT-5-codex slugs remain compatible for existing workflows.

- Works with `generateText`, `streamText`, and `generateObject` (native JSON Schema support via `--output-schema`)
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

> **⚠️ Codex CLI Version**: Requires Codex CLI **>= 0.42.0** for `--experimental-json` and `--output-schema` support. **>= 0.60.0 recommended** for `gpt-5.1-codex-max` and `xhigh` reasoning effort. If you supply your own Codex CLI (global install or custom `codexPath`/`allowNpx`), check it with `codex --version` and upgrade if needed. The optional dependency `@openai/codex` in this package pulls a compatible version automatically.
>
> ```bash
> npm i -g @openai/codex@latest
> ```

## Quick Start

Text generation

```js
import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5.1-codex', {
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

Streaming

```js
import { streamText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

// The provider works with both `gpt-5.1` and `gpt-5.1-codex`; use the latter for
// the Codex CLI specific slug. Legacy `gpt-5` slugs still work if you need them.
const { textStream } = await streamText({
  model: codexCli('gpt-5.1-codex', { allowNpx: true, skipGitRepoCheck: true }),
  prompt: 'Write two short lines of encouragement.',
});
for await (const chunk of textStream) process.stdout.write(chunk);
```

Object generation (Zod)

```js
import { generateObject } from 'ai';
import { z } from 'zod';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const schema = z.object({ name: z.string(), age: z.number().int() });
const { object } = await generateObject({
  model: codexCli('gpt-5.1-codex', { allowNpx: true, skipGitRepoCheck: true }),
  schema,
  prompt: 'Generate a small user profile.',
});
console.log(object);
```

## Features

- AI SDK v6 compatible (LanguageModelV3)
- Streaming and non‑streaming
- **Configurable logging** (v0.5.0+) - Verbose mode, custom loggers, or silent operation
- **Tool streaming support** (v0.3.0+) - Monitor autonomous tool execution in real-time
- **Native JSON Schema support** via `--output-schema` (API-enforced with `strict: true`)
- JSON object generation with Zod schemas (100-200 fewer tokens per request vs prompt engineering)
- Safe defaults for non‑interactive automation (`on-failure`, `workspace-write`, `--skip-git-repo-check`)
- Fallback to `npx @openai/codex` when not on PATH (`allowNpx`)
- Usage tracking from experimental JSON event format
- **Image support** - Pass images to vision-capable models via `--image` flag

### Image Support

The provider supports multimodal (image) inputs for vision-capable models:

```js
import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';
import { readFileSync } from 'fs';

const model = codexCli('gpt-5.1-codex', { allowNpx: true, skipGitRepoCheck: true });
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

**Not supported:**

- HTTP/HTTPS URLs (images must be provided as binary data)

Images are written to temporary files and passed to Codex CLI via the `--image` flag. Temp files are automatically cleaned up after the request completes.

See [examples/image-support.mjs](examples/image-support.mjs) for a complete working example.

### Tool Streaming (v0.3.0+)

The provider supports comprehensive tool streaming, enabling real-time monitoring of Codex CLI's autonomous tool execution:

```js
import { streamText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const result = await streamText({
  model: codexCli('gpt-5.1-codex', { allowNpx: true, skipGitRepoCheck: true }),
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

**Limitation:** Real-time output streaming (`output-delta` events) not yet available. Tool outputs delivered in final `tool-result` event. See `examples/streaming-tool-calls.mjs` and `examples/streaming-multiple-tools.mjs` for usage patterns.

### Logging Configuration (v0.5.0+)

Control logging verbosity and integrate with your observability stack:

```js
import { codexCli } from 'ai-sdk-provider-codex-cli';

// Default: warn/error only (clean production output)
const model = codexCli('gpt-5.1-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
});

// Verbose mode: enable debug/info logs for troubleshooting
const verboseModel = codexCli('gpt-5.1-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  verbose: true, // Shows all log levels
});

// Custom logger: integrate with Winston, Pino, Datadog, etc.
const customModel = codexCli('gpt-5.1-codex', {
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
const silentModel = codexCli('gpt-5.1-codex', {
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

See `examples/logging-*.mjs` for complete examples and [docs/ai-sdk-v5/guide.md](docs/ai-sdk-v5/guide.md) for detailed configuration.

### Text Streaming behavior

**Status:** Incremental streaming not currently supported with `--experimental-json` format (expected in future Codex CLI releases)

The `--experimental-json` output format (introduced Sept 25, 2025) currently only emits `item.completed` events with full text content. Incremental streaming via `item.updated` or delta events is not yet implemented by OpenAI.

**What this means:**

- `streamText()` works functionally but delivers the entire response in a single chunk after generation completes
- No incremental text deltas—you wait for the full response, then receive it all at once
- The AI SDK's streaming interface is supported, but actual incremental streaming is not available

**Future support:** The Codex CLI commit (344d4a1d) introducing experimental JSON explicitly notes: "or other item types like `item.output_delta` when we need streaming" and states "more event types and item types to come."

When OpenAI adds streaming support, this provider will be updated to handle those events and enable true incremental streaming.

## Documentation

- Getting started, configuration, and troubleshooting live in `docs/`:
  - [docs/ai-sdk-v5/guide.md](docs/ai-sdk-v5/guide.md) – full usage guide and examples
  - [docs/ai-sdk-v5/configuration.md](docs/ai-sdk-v5/configuration.md) – all settings and how they map to CLI flags
  - [docs/ai-sdk-v5/troubleshooting.md](docs/ai-sdk-v5/troubleshooting.md) – common issues and fixes
  - [docs/ai-sdk-v5/limitations.md](docs/ai-sdk-v5/limitations.md) – known constraints and behavior differences
- See [examples/](examples/) for runnable scripts covering core usage, streaming, permissions/sandboxing, and object generation.

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

## Model Parameters & Advanced Options (v0.4.0+)

Control reasoning effort, verbosity, and advanced Codex features at model creation time:

```ts
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5.1-codex', {
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
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5.1-codex', {
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

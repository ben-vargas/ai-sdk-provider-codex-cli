# AI SDK Provider for Codex CLI

[![npm version](https://img.shields.io/npm/v/ai-sdk-provider-codex-cli.svg)](https://www.npmjs.com/package/ai-sdk-provider-codex-cli)
[![npm downloads](https://img.shields.io/npm/dm/ai-sdk-provider-codex-cli.svg)](https://www.npmjs.com/package/ai-sdk-provider-codex-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-43853d?logo=node.js&logoColor=white)
![AI SDK v5](https://img.shields.io/badge/AI%20SDK-v5-000?logo=vercel&logoColor=white)
![Modules: ESM + CJS](https://img.shields.io/badge/modules-ESM%20%2B%20CJS-3178c6)
![TypeScript](https://img.shields.io/badge/TypeScript-blue)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/issues)
[![Latest Release](https://img.shields.io/github/v/release/ben-vargas/ai-sdk-provider-codex-cli?display_name=tag)](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/releases/latest)

A community provider for Vercel AI SDK v5 that uses OpenAI’s Codex CLI (non‑interactive `codex exec`) to talk to GPT‑5 class models (`gpt-5` and the Codex-specific `gpt-5-codex` slug) with your ChatGPT Plus/Pro subscription. The provider spawns the Codex CLI process, parses its JSONL output, and adapts it to the AI SDK LanguageModelV2 interface.

- Works with `generateText`, `streamText`, and `generateObject` (native JSON Schema support via `--output-schema`)
- Uses ChatGPT OAuth from `codex login` (tokens in `~/.codex/auth.json`) or `OPENAI_API_KEY`
- Node-only (spawns a local process); supports CI and local dev
- **v0.3.0**: Adds comprehensive tool streaming support for monitoring autonomous tool execution
- **v0.2.0 Breaking Changes**: Switched to `--experimental-json` and native schema enforcement (see [CHANGELOG](CHANGELOG.md))

## Installation

1. Install and authenticate Codex CLI

```bash
npm i -g @openai/codex
codex login   # or set OPENAI_API_KEY
```

> **⚠️ Version Requirement**: Requires Codex CLI **>= 0.42.0** for `--experimental-json` and `--output-schema` support. **>= 0.44.0 recommended** for full usage tracking and tool streaming support. Check your version with `codex --version` and upgrade if needed:
>
> ```bash
> npm i -g @openai/codex@latest
> ```

2. Install provider and AI SDK

```bash
npm i ai ai-sdk-provider-codex-cli
```

## Quick Start

Text generation

```js
import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5-codex', {
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

// The provider works with both `gpt-5` and `gpt-5-codex`; use the latter for
// the Codex CLI specific slug.
const { textStream } = await streamText({
  model: codexCli('gpt-5-codex', { allowNpx: true, skipGitRepoCheck: true }),
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
  model: codexCli('gpt-5-codex', { allowNpx: true, skipGitRepoCheck: true }),
  schema,
  prompt: 'Generate a small user profile.',
});
console.log(object);
```

## Features

- AI SDK v5 compatible (LanguageModelV2)
- Streaming and non‑streaming
- **Tool streaming support** (v0.3.0+) - Monitor autonomous tool execution in real-time
- **Native JSON Schema support** via `--output-schema` (API-enforced with `strict: true`)
- JSON object generation with Zod schemas (100-200 fewer tokens per request vs prompt engineering)
- Safe defaults for non‑interactive automation (`on-failure`, `workspace-write`, `--skip-git-repo-check`)
- Fallback to `npx @openai/codex` when not on PATH (`allowNpx`)
- Usage tracking from experimental JSON event format

### Tool Streaming (v0.3.0+)

The provider supports comprehensive tool streaming, enabling real-time monitoring of Codex CLI's autonomous tool execution:

```js
import { streamText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const result = await streamText({
  model: codexCli('gpt-5-codex', { allowNpx: true, skipGitRepoCheck: true }),
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
- Autonomy/sandbox:
  - `fullAuto` (equivalent to `--full-auto`)
  - `dangerouslyBypassApprovalsAndSandbox` (bypass approvals and sandbox; dangerous)
  - Otherwise the provider writes `-c approval_policy=...` and `-c sandbox_mode=...` for you; defaults to `on-failure` and `workspace-write`
- `skipGitRepoCheck`: enable by default for CI/non‑repo contexts
- `color`: `always` | `never` | `auto`
- `outputLastMessageFile`: by default the provider sets a temp path and reads it to capture final text reliably

See [docs/ai-sdk-v5/configuration.md](docs/ai-sdk-v5/configuration.md) for the full list and examples.

## Model Parameters & Advanced Options (v0.4.0+)

Control reasoning effort, verbosity, and advanced Codex features at model creation time:

```ts
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,

  // Reasoning & verbosity
  reasoningEffort: 'medium', // minimal | low | medium | high
  reasoningSummary: 'auto', // auto | detailed (Note: 'concise' and 'none' are rejected by API)
  reasoningSummaryFormat: 'none', // none | experimental
  modelVerbosity: 'high', // low | medium | high

  // Advanced features
  includePlanTool: true, // adds --include-plan-tool
  profile: 'production', // adds --profile production
  oss: false, // adds --oss when true
  webSearch: true, // maps to -c tools.web_search=true

  // Generic overrides (maps to -c key=value)
  configOverrides: {
    experimental_resume: '/tmp/session.jsonl',
    sandbox_workspace_write: { network_access: true },
  },
});
```

Nested override objects are flattened to dotted keys (e.g., the example above emits
`-c sandbox_workspace_write.network_access=true`). Arrays are serialized to JSON strings.

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

# AI SDK Provider for Codex CLI

[![npm version](https://img.shields.io/npm/v/ai-sdk-provider-codex-cli.svg)](https://www.npmjs.com/package/ai-sdk-provider-codex-cli)
[![npm downloads](https://img.shields.io/npm/dm/ai-sdk-provider-codex-cli.svg)](https://www.npmjs.com/package/ai-sdk-provider-codex-cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-43853d?logo=node.js&logoColor=white)
![AI SDK v4](https://img.shields.io/badge/AI%20SDK-v4-000?logo=vercel&logoColor=white)
![Modules: ESM + CJS](https://img.shields.io/badge/modules-ESM%20%2B%20CJS-3178c6)
![TypeScript](https://img.shields.io/badge/TypeScript-blue)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/issues)
[![Latest Release](https://img.shields.io/github/v/release/ben-vargas/ai-sdk-provider-codex-cli?display_name=tag)](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/releases/latest)

A community provider for Vercel AI SDK v4 that uses OpenAI’s Codex CLI (non‑interactive `codex exec`) to talk to GPT‑5 class models with your ChatGPT Plus/Pro subscription. The provider spawns the Codex CLI process, parses its JSONL output, and adapts it to the AI SDK LanguageModelV1 interface.

Note: For AI SDK v5 support, see the `main` branch and install the `latest` tag from npm. This branch targets AI SDK v4 and is published under the `ai-sdk-v4` dist-tag.

- Works with `generateText`, `streamText`, and `generateObject` (JSON schemas via prompt engineering)
- Uses ChatGPT OAuth from `codex login` (tokens in `~/.codex/auth.json`) or `OPENAI_API_KEY`
- Node-only (spawns a local process); supports CI and local dev

## Version Compatibility

- Provider (v5 line, main branch): published as `latest`, compatible with AI SDK v5.
- Provider (v4 line, this branch): published as `ai-sdk-v4`, compatible with AI SDK v4.

| Provider Version | AI SDK Version | NPM Tag     | Status       | Branch     |
|------------------|----------------|-------------|--------------|------------|
| 0.1.x            | v5             | `latest`    | Active       | `main`     |
| 0.1.0-ai-sdk-v4  | v4             | `ai-sdk-v4` | Maintenance  | `ai-sdk-v4`|

### Installing the Right Version

- AI SDK v5 (recommended): `npm i ai-sdk-provider-codex-cli ai` (or `@latest`)
- AI SDK v4 (this branch): `npm i ai-sdk-provider-codex-cli@ai-sdk-v4 ai@^4.3.16`

## AI SDK v4 vs v5

- For AI SDK v4 (this branch):
  - Install: `npm i ai-sdk-provider-codex-cli@ai-sdk-v4 ai@^4.3.16`
  - Usage (non-streaming):
    
    ```ts
    import { generateText } from 'ai';
    import { codexCli } from 'ai-sdk-provider-codex-cli';

    const { text } = await generateText({
      model: codexCli('gpt-5', { allowNpx: true, skipGitRepoCheck: true }),
      prompt: 'Hello from v4',
    });
    ```

  - Usage (streaming):

    ```ts
    import { streamText } from 'ai';
    import { codexCli } from 'ai-sdk-provider-codex-cli';

    const { textStream } = await streamText({
      model: codexCli('gpt-5', { allowNpx: true, skipGitRepoCheck: true }),
      prompt: 'Stream a short reply',
    });
    for await (const chunk of textStream) process.stdout.write(chunk);
    ```

- For AI SDK v5 (main branch):
  - Install: `npm i ai-sdk-provider-codex-cli ai` (or `@latest`)
  - Usage (streaming):

    ```ts
    import { streamText } from 'ai';
    import { codexCli } from 'ai-sdk-provider-codex-cli';

    const result = streamText({
      model: codexCli('gpt-5'),
      prompt: 'Hello from v5',
    });
    const text = await result.text;
    ```

  - See the `main` branch README for full v5 docs and examples.

## Installation

1. Install and authenticate Codex CLI

```bash
npm i -g @openai/codex
codex login   # or set OPENAI_API_KEY
```

2. Install provider and AI SDK

```bash
# AI SDK v4 users (this branch)
npm i ai@^4.3.16 ai-sdk-provider-codex-cli@ai-sdk-v4

# AI SDK v5 users (use main branch/latest tag)
# npm i ai ai-sdk-provider-codex-cli
```

## Quick Start

Text generation

```js
import { generateText } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';

const model = codexCli('gpt-5', {
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

const { textStream } = await streamText({
  model: codexCli('gpt-5', { allowNpx: true, skipGitRepoCheck: true }),
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
  model: codexCli('gpt-5', { allowNpx: true, skipGitRepoCheck: true }),
  schema,
  prompt: 'Generate a small user profile.',
});
console.log(object);
```

## Features

- AI SDK v5 compatible (LanguageModelV2)
- Streaming and non‑streaming
- JSON object generation with Zod schemas (prompt‑engineered)
- Safe defaults for non‑interactive automation (`on-failure`, `workspace-write`, `--skip-git-repo-check`)
- Fallback to `npx @openai/codex` when not on PATH (`allowNpx`)

### Streaming behavior

When using `codex exec --json`, the Codex CLI intentionally suppresses token/assistant deltas in its JSON event stream. Instead, it writes the final assistant message to the file you pass via `--output-last-message` and then signals completion. This provider:

- emits `response-metadata` early (as soon as the session is configured), and
- returns the final text as a single `text-delta` right before `finish`.

This is expected behavior for JSON mode in Codex exec, so streaming typically “feels” like a final chunk rather than a gradual trickle.

## Documentation

- Getting started, configuration, and troubleshooting live in `docs/` (v4 docs coming soon in this branch).
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

## Zod Compatibility

- Peer supports `zod@^3`
- Validation logic normalizes zod v3/v4 error shapes

## Limitations

- Node ≥ 18, local process only (no Edge)
- Codex JSON mode (`codex exec --json`) suppresses mid‑response deltas; streaming typically yields a final chunk. The CLI writes the final assistant text via `--output-last-message`, which this provider reads and emits at the end.
- Some AI SDK parameters are unsupported by Codex CLI (e.g., temperature/topP/penalties); the provider surfaces warnings and ignores them

## Disclaimer

This is a community provider and not an official OpenAI or Vercel product. You are responsible for complying with all applicable terms and ensuring safe usage.

## License

MIT

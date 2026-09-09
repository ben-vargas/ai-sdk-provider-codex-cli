# Codex CLI Provider – AI SDK v7 Guide

This guide explains how to use the Codex CLI provider with Vercel AI SDK v7 for text generation, streaming, JSON object generation, and persistent app-server sessions.

## Requirements

- **AI SDK v7** (`ai@^7`) and `ai-sdk-provider-codex-cli@^2`
- **Node.js 22 or later** (AI SDK v7 requirement)
- **ESM only** — version 2.x of this package ships no CommonJS build. `require('ai-sdk-provider-codex-cli')` is not supported; use `import` (add `"type": "module"` to your `package.json` or use `.mjs` files)
- **zod** peer dependency: `^4.1.8`
- A working Codex CLI (`codex login` or `OPENAI_API_KEY`)

Using AI SDK v6? Stay on the 1.x line: see [migration-v6-to-v7.md](./migration-v6-to-v7.md#staying-on-ai-sdk-v6).

## Getting Started

1. Install Codex CLI and authenticate:

```bash
npm i -g @openai/codex
codex login   # or set OPENAI_API_KEY
```

2. Install AI SDK v7 and this provider:

```bash
npm i ai@^7 ai-sdk-provider-codex-cli@^2
```

## Choosing a Provider Mode

The package ships two provider modes:

- **`codexExec`** (also `createCodexExec`): spawns a fresh `codex exec` process per call. Simple, stateless, no cleanup required.
- **`codexAppServer`** (also `createCodexAppServer`): a persistent `codex app-server` JSON-RPC client. Shared process, true incremental streaming, optional stateful threads, model discovery, approvals, and local MCP tools. Call `provider.close()` when finished.

The legacy `codexCli` / `createCodexCli` exports remain as aliases for exec mode.

## Discovering Models

Model slugs are owned by Codex/OpenAI and change independently of this package — do not hard-code a catalog. Query the models your installed Codex CLI actually offers:

```js
import { listModels } from 'ai-sdk-provider-codex-cli';

const { models, defaultModel } = await listModels();
console.log('default:', defaultModel?.id);
console.log(models.map((m) => m.id));
```

`listModels()` starts a temporary app-server process. If you already hold an app-server provider, reuse its process instead:

```js
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer();
const { models } = await provider.listModels();
console.log(models.map((m) => m.id));
await provider.close();
```

The examples in these docs use `gpt-6-astra`, the default model returned by `model/list` at the time of writing. Substitute whatever `listModels()` returns for you.

## Basic Usage

```js
import { generateText, streamText, generateObject } from 'ai';
import { codexExec } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

const model = codexExec('gpt-6-astra', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
});

// Text
const { text } = await generateText({ model, prompt: 'Say hello in one word.' });

// Streaming
const { textStream } = await streamText({ model, prompt: 'Two short lines.' });
for await (const chunk of textStream) process.stdout.write(chunk);

// Object (JSON)
const schema = z.object({ name: z.string(), age: z.number().int() });
const { object } = await generateObject({ model, schema, prompt: 'Generate a user.' });
```

## Conversation History

Use AI SDK messages to retain context:

```js
const messages = [
  { role: 'user', content: 'My name is Dana.' },
  { role: 'assistant', content: 'Hi Dana!' },
  { role: 'user', content: 'What did I just tell you my name was?' },
];
const { text } = await generateText({ model, messages });
```

For long-running conversations, prefer app-server persistent threads (below) so Codex keeps server-side context instead of replaying a transcript each call.

## System Instructions

AI SDK v7 renamed the top-level `system` option to `instructions`, and **rejects `{ role: 'system' }` messages inside `messages` by default**:

```js
const { text } = await generateText({
  model,
  instructions: 'You are a terse assistant. Answer in one sentence.',
  prompt: 'Why is the sky blue?',
});
```

If you have persisted chats that already contain system messages, either move that text into `instructions`, or opt in to the old behavior with `allowSystemInMessages: true` (only for trusted, server-controlled messages). See [migration-v6-to-v7.md](./migration-v6-to-v7.md) for details.

## Structured Output (JSON)

The provider uses native `--output-schema` (exec) / `outputSchema` (app-server) with OpenAI strict mode for API-level JSON enforcement.

**⚠️ Important limitations:**

- Optional fields are **NOT supported** by OpenAI strict mode (all fields must be required)
- Format validators (`.email()`, `.url()`, `.uuid()`) are stripped (use descriptions instead)
- Pattern validators (`.regex()`) are stripped (use descriptions instead)

See [limitations.md](./limitations.md) and [LIMITATIONS.md](../../LIMITATIONS.md) for full details.

Tips:

- Add clear field descriptions to your Zod schema (especially for format hints like "UUID format", "YYYY-MM-DD date")
- All fields must be required (no `.optional()`)
- Use descriptions instead of format validators
- Keep constraints realistic for better adherence

## Reasoning Effort

AI SDK v7 adds a provider-agnostic, top-level `reasoning` option. This provider maps it to Codex reasoning effort:

```js
const { text } = await generateText({
  model: codexExec('gpt-6-astra', { allowNpx: true, skipGitRepoCheck: true }),
  reasoning: 'high', // 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  prompt: 'Prove that the square root of 2 is irrational.',
});
```

Provider-specific options take precedence when both are present:

- exec: `providerOptions['codex-cli'].reasoningEffort` wins over top-level `reasoning`
- app-server: `providerOptions['codex-app-server'].effort` wins over top-level `reasoning`

`reasoning: 'provider-default'` (or omitting the option) leaves your constructor settings and Codex defaults untouched. The full precedence chain is documented in [configuration.md](./configuration.md#reasoning-precedence).

## Image Inputs

Both providers accept image inputs for vision-capable models using the AI SDK v7 canonical `file` part:

```js
import { readFileSync } from 'node:fs';

const { text } = await generateText({
  model,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'What do you see in this image?' },
        { type: 'file', data: readFileSync('./screenshot.png'), mediaType: 'image/png' },
      ],
    },
  ],
});
```

- `mediaType` accepts a full IANA type (`'image/png'`) or a top-level segment (`'image'`).
- Inline data (`Uint8Array`, `Buffer`, base64, `data:` URLs) is written to a temp file and passed to Codex (`--image` for exec, `localImage` for app-server); temp files are cleaned up after each request.
- **Remote URLs:** the provider declares `supportedUrls = {}`, so the AI SDK downloads `https://` file parts itself and hands the provider inline data, which flows through the same temp-file path. Raw remote-URL shapes that bypass the SDK download produce an unsupported warning in exec mode.
- Non-image files, `file://` URLs, file `reference` data, and `reasoning-file` / `custom` parts are not supported and produce warnings. See [limitations.md](./limitations.md).

## Permissions & Sandbox

The provider applies safe defaults for non‑interactive execution. You can override them per call via provider settings:

- `fullAuto: true` → `--full-auto` (exec)
- `dangerouslyBypassApprovalsAndSandbox: true` → `--dangerously-bypass-approvals-and-sandbox` (exec)
- Otherwise, the exec provider writes config overrides: `-c approval_policy=...` and `-c sandbox_mode=...`; the app-server provider passes `approvalPolicy` / `sandboxPolicy` on the thread.

Recommended defaults for CI/local automation:

- `approvalMode: 'on-failure'`
- `sandboxMode: 'workspace-write'`
- `skipGitRepoCheck: true` (exec)

### Approvals: SDK tools vs Codex-native

Two distinct approval systems exist; don't conflate them:

- **AI SDK tool approvals** (`toolApproval` on `generateText`/`streamText`) gate tools _you_ define in the AI SDK tool loop. Codex does not see these.
- **Codex-native approvals** gate commands, file changes, skills, and MCP tool calls that Codex executes itself. Handle them with app-server `serverRequests` handlers, or set `autoApprove: true` to accept them by default. The stream surfaces them as `tool-approval-request` parts.

## Streaming Behavior

**`codexExec` mode:** incremental streaming is not currently available with `codex exec --experimental-json`. The format only emits `item.completed` events with full text, so `streamText()` works but delivers the text in a single chunk at the end.

**`codexAppServer` mode:** supports true incremental deltas via `item/agentMessage/delta`, so `streamText()` emits progressively as tokens arrive.

Consume the full event stream via `result.stream` (AI SDK v7 renamed `fullStream`):

```js
import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer();
const result = await streamText({
  model: provider('gpt-6-astra'),
  prompt: 'List the files here, then summarize the largest one.',
});

for await (const part of result.stream) {
  if (part.type === 'text-delta') process.stdout.write(part.text);
  if (part.type === 'tool-call') console.log('\n🔧 tool:', part.toolName);
  if (part.type === 'tool-result') console.log('✅ result received');
}

await provider.close();
```

Tool activity (`tool-input-start`, `tool-call`, `tool-result`, …) is emitted in real time in both modes, with `providerExecuted: true` because Codex runs its own tools autonomously.

### Raw chunks (advanced)

To see the raw Codex JSON-RPC notifications as `raw` stream parts, opt in with the v7 `include` option:

```js
const result = await streamText({
  model: provider('gpt-6-astra'),
  prompt: 'Say hello.',
  include: { rawChunks: true },
});

for await (const part of result.stream) {
  if (part.type === 'raw') console.log(part.rawValue);
}
```

`providerOptions['codex-app-server'].includeRawChunks: true` (or the same key in `defaultSettings`) is a provider-specific opt-in with the same effect.

## App-Server Sessions (Stateful Threads)

By default the app-server provider is stateless (a new ephemeral thread per call). Opt in to persistent threads to keep server-side context across calls:

```js
import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const provider = createCodexAppServer();

const first = await generateText({
  model: provider('gpt-6-astra'),
  prompt: 'Start a migration checklist.',
  providerOptions: {
    'codex-app-server': { threadMode: 'persistent' },
  },
});

const threadId = first.finalStep.providerMetadata?.['codex-app-server']?.threadId;

const second = await generateText({
  model: provider('gpt-6-astra'),
  prompt: 'Continue from step 2.',
  providerOptions: {
    'codex-app-server': { threadId },
  },
});

await provider.close();
```

Note the AI SDK v7 result shape: final-step metadata lives on `result.finalStep.providerMetadata` (for `streamText`, `await result.finalStep` first).

Related settings: `threadMode`, `resume` (resume an existing thread id), `persistExtendedHistory`, and `onSessionCreated`, which hands you a live session object exposing `injectMessage()` and `interrupt()` for mid-turn control. See [configuration.md](./configuration.md#app-server-settings).

## Logging Configuration

Control how the provider logs execution information, warnings, and errors. Both provider modes accept the same `verbose` / `logger` settings.

### Log Levels

- **`debug`**: Detailed execution tracing (request/response, tool calls, stream events)
- **`info`**: General execution flow information (session initialization, completion)
- **`warn`**: Warnings about configuration issues or unexpected behavior
- **`error`**: Error messages for failures and exceptions

**Without verbose mode**, only `warn` and `error` messages are logged. **With `verbose: true`**, `debug` and `info` messages are also logged.

### Basic Configuration

```ts
import { createCodexExec } from 'ai-sdk-provider-codex-cli';

// Default: logs warnings and errors to console
const defaultCodex = createCodexExec();

// Disable all logging
const silentCodex = createCodexExec({
  defaultSettings: {
    logger: false,
  },
});

// Custom logger - must implement all four log levels
const customCodex = createCodexExec({
  defaultSettings: {
    verbose: true,
    logger: {
      debug: (message) => myLogger.debug('Codex:', message),
      info: (message) => myLogger.info('Codex:', message),
      warn: (message) => myLogger.warn('Codex:', message),
      error: (message) => myLogger.error('Codex:', message),
    },
  },
});

// Model-specific override
const model = customCodex('gpt-6-astra', {
  logger: false, // Disable logging for this model only
});
```

### Logger Options

- `undefined` (default): Uses `console.debug`, `console.info`, `console.warn`, and `console.error` with `[DEBUG]`/`[INFO]`/`[WARN]`/`[ERROR]` tags
- `false`: Disables all logging
- Custom `Logger` object: Must implement `debug`, `info`, `warn`, and `error` methods

### Combining with Error Handling

```ts
import { createCodexExec } from 'ai-sdk-provider-codex-cli';
import { generateText } from 'ai';

const codex = createCodexExec({
  defaultSettings: { verbose: true },
});

try {
  const result = await generateText({
    model: codex('gpt-6-astra'),
    prompt: 'Hello!',
  });
  console.log(result.text);
} catch (error) {
  console.error('Generation failed:', error);
  // Check error.data for additional context (exitCode, stderr, etc.)
  if (error.data) {
    console.error('Error details:', error.data);
  }
}
```

## Examples

See [examples/](../../examples/) for runnable scripts (organized as `examples/exec/` and `examples/app-server/`) that cover:

- Basic text generation and streaming
- Conversation history and instructions
- Permissions & sandbox modes
- JSON object generation: basic, nested, constraints, advanced
- Image inputs, raw chunks, model listing, local MCP tools, session injection

## See Also

- [configuration.md](./configuration.md) – every setting and its CLI/protocol mapping
- [limitations.md](./limitations.md) – known constraints
- [troubleshooting.md](./troubleshooting.md) – common issues and fixes
- [migration-v6-to-v7.md](./migration-v6-to-v7.md) – upgrading from 1.x (AI SDK v6)

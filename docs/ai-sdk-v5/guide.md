# Codex CLI Provider – AI SDK v5 Guide

This guide explains how to use the Codex CLI provider with Vercel AI SDK v5 for text generation, streaming, and JSON object generation.

## Getting Started

1. Install Codex CLI and authenticate:

```bash
npm i -g @openai/codex
codex login   # or set OPENAI_API_KEY
```

2. Install AI SDK and this provider:

```bash
npm i ai ai-sdk-provider-codex-cli
```

## Basic Usage

```js
import { generateText, streamText, generateObject } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

const model = codexCli('gpt-5.1-codex', {
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

## Structured Output (JSON)

**v0.2.0+**: The provider uses native `--output-schema` support with OpenAI strict mode for API-level JSON enforcement. Schemas are passed directly to the API, eliminating 100-200 tokens per request and improving reliability.

**⚠️ Important Limitations:**

- Optional fields are **NOT supported** by OpenAI strict mode (all fields must be required)
- Format validators (`.email()`, `.url()`, `.uuid()`) are stripped (use descriptions instead)
- Pattern validators (`.regex()`) are stripped (use descriptions instead)

See [LIMITATIONS.md](../../LIMITATIONS.md) for full details.

Tips:

- Add clear field descriptions to your Zod schema (especially for format hints like "UUID format", "YYYY-MM-DD date")
- All fields must be required (no `.optional()`)
- Use descriptions instead of format validators
- Keep constraints realistic for better adherence

## Permissions & Sandbox

The provider applies safe defaults for non‑interactive execution. You can override them per call via provider settings:

- `fullAuto: true` → `--full-auto`
- `dangerouslyBypassApprovalsAndSandbox: true` → `--dangerously-bypass-approvals-and-sandbox`
- Otherwise, the provider writes config overrides: `-c approval_policy=...` and `-c sandbox_mode=...`.

Recommended defaults for CI/local automation:

- `approvalMode: 'on-failure'`
- `sandboxMode: 'workspace-write'`
- `skipGitRepoCheck: true`

## Streaming Behavior

**Status:** Incremental streaming not currently supported with `--experimental-json` format (expected in future Codex CLI releases)

The `--experimental-json` output format (introduced Sept 25, 2025) currently only emits `item.completed` events with full text content. Incremental streaming via `item.updated` or delta events is not yet implemented by OpenAI.

**What this means:**

- `streamText()` works functionally but delivers the entire response in a single chunk after generation completes
- No incremental text deltas—you wait for the full response, then receive it all at once
- The AI SDK's streaming interface is supported, but actual incremental streaming is not available

**How the provider handles this:**

1. Emits `response-metadata` stream part when the session is configured
2. Waits for `item.completed` event with the final assistant message
3. Emits a single `text-delta` with the full text
4. Emits `finish`

**Future support:** The Codex CLI commit (344d4a1d) introducing experimental JSON explicitly notes: "or other item types like `item.output_delta` when we need streaming" and states "more event types and item types to come."

When OpenAI adds streaming support, this provider will be updated to handle those events and enable true incremental streaming. Your code using the AI SDK stream API will remain compatible.

## Logging Configuration

Control how the provider logs execution information, warnings, and errors. The logger supports multiple log levels and a verbose mode for detailed debugging.

### Log Levels

The provider supports four log levels:

- **`debug`**: Detailed execution tracing (request/response, tool calls, stream events)
- **`info`**: General execution flow information (session initialization, completion)
- **`warn`**: Warnings about configuration issues or unexpected behavior
- **`error`**: Error messages for failures and exceptions

### Basic Configuration

```typescript
import { createCodexCli } from 'ai-sdk-provider-codex-cli';

// Default: logs warnings and errors to console
const defaultCodex = createCodexCli();

// Disable all logging
const silentCodex = createCodexCli({
  defaultSettings: {
    logger: false,
  },
});

// Custom logger - must implement all four log levels
const customCodex = createCodexCli({
  defaultSettings: {
    logger: {
      debug: (message) => myLogger.debug('Codex:', message),
      info: (message) => myLogger.info('Codex:', message),
      warn: (message) => myLogger.warn('Codex:', message),
      error: (message) => myLogger.error('Codex:', message),
    },
  },
});

// Model-specific logger override
const model = customCodex('gpt-5.1-codex', {
  logger: false, // Disable logging for this model only
});
```

### Verbose Mode (Debug Logging)

Enable verbose mode to see detailed execution logs, including:

- Request/response tracing
- Tool execution lifecycle (tool calls, results, errors)
- Stream event processing
- Command execution details and token usage
- Session management

**Without verbose mode**, only `warn` and `error` messages are logged.
**With verbose mode enabled**, `debug` and `info` messages are also logged.

```typescript
import { createCodexCli } from 'ai-sdk-provider-codex-cli';

// Enable verbose logging for debugging
const codexWithDebug = createCodexCli({
  defaultSettings: {
    verbose: true, // Enable debug and info logging
  },
});

// Use with custom logger
const codexCustom = createCodexCli({
  defaultSettings: {
    verbose: true,
    logger: {
      debug: (msg) => console.log(`[DEBUG] ${msg}`),
      info: (msg) => console.log(`[INFO] ${msg}`),
      warn: (msg) => console.warn(`[WARN] ${msg}`),
      error: (msg) => console.error(`[ERROR] ${msg}`),
    },
  },
});

// Model-specific verbose override
const model = codexWithDebug('gpt-5.1-codex', {
  verbose: false, // Disable verbose for this specific model
});
```

### What Gets Logged in Verbose Mode

With `verbose: true`, you'll see intermediate process logs including:

**For `generateText()` calls:**

```
[DEBUG] [codex-cli] Starting doGenerate request with model: gpt-5.1-codex
[DEBUG] [codex-cli] Request mode: regular, response format: none
[DEBUG] [codex-cli] Converted 2 messages, response format: none
[DEBUG] [codex-cli] Executing Codex CLI: npx with 15 arguments, cwd: default
[DEBUG] [codex-cli] Received event type: thread.started
[DEBUG] [codex-cli] Session started: thread-abc123
[DEBUG] [codex-cli] Received event type: turn.completed
[INFO] [codex-cli] Request completed - Session: thread-abc123, Duration: 1523ms, Tokens: 373
[DEBUG] [codex-cli] Token usage - Input: 245, Output: 128, Total: 373
```

**For `streamText()` calls with tools:**

```
[DEBUG] [codex-cli] Starting doStream request with model: gpt-5.1-codex
[DEBUG] [codex-cli] Converted 1 messages for streaming, response format: none
[DEBUG] [codex-cli] Executing Codex CLI for streaming: npx with 14 arguments
[DEBUG] [codex-cli] Stream event: thread.started
[DEBUG] [codex-cli] Stream session started: thread-xyz789
[DEBUG] [codex-cli] Stream event: item.started
[DEBUG] [codex-cli] Tool detected: exec, item type: command_execution
[DEBUG] [codex-cli] Emitting tool invocation: exec
[DEBUG] [codex-cli] Stream event: item.completed
[DEBUG] [codex-cli] Tool completed: exec
[DEBUG] [codex-cli] Received assistant message, length: 142
[INFO] [codex-cli] Stream completed - Session: thread-xyz789, Duration: 3241ms, Tokens: 768
[DEBUG] [codex-cli] Token usage - Input: 512, Output: 256, Total: 768
```

### Logger Options

- `undefined` (default): Uses `console.debug`, `console.info`, `console.warn`, and `console.error`
- `false`: Disables all logging
- Custom `Logger` object: Must implement `debug`, `info`, `warn`, and `error` methods

### Combining with Error Handling

For comprehensive debugging, combine verbose logging with error handling:

```typescript
import { createCodexCli } from 'ai-sdk-provider-codex-cli';
import { generateText } from 'ai';

const codexCli = createCodexCli({
  defaultSettings: {
    verbose: true,
    logger: {
      debug: (msg) => myLogger.debug(msg),
      info: (msg) => myLogger.info(msg),
      warn: (msg) => myLogger.warn(msg),
      error: (msg) => myLogger.error(msg),
    },
  },
});

try {
  const result = await generateText({
    model: codexCli('gpt-5.1-codex'),
    prompt: 'Hello!',
  });
} catch (error) {
  console.error('Generation failed:', error);
  // Check error.data for additional context (exitCode, stderr, etc.)
  if (error.data) {
    console.error('Error details:', error.data);
  }
}
```

## Examples

See `examples/` for runnable scripts that cover:

- Basic text generation and streaming
- Conversation history and system messages
- Permissions & sandbox modes
- JSON object generation: basic, nested, constraints, advanced

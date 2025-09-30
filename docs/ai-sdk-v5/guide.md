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

const model = codexCli('gpt-5', {
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

## Examples

See `examples/` for runnable scripts that cover:

- Basic text generation and streaming
- Conversation history and system messages
- Permissions & sandbox modes
- JSON object generation: basic, nested, constraints, advanced

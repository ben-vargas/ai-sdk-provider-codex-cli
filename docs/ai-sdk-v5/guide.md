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

The provider prompt‑engineers the model to output JSON only and then extracts the first balanced JSON block. AI SDK validates against your Zod schema.

Tips:

- Add clear field descriptions to your Zod schema.
- Keep constraints realistic for better adherence.
- Provide concrete examples in the prompt if the format is tricky.

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

When using `codex exec --json`, Codex does not stream assistant text tokens in its JSON event output. Instead, it:

- suppresses assistant deltas in the JSONL stream, and
- writes the final assistant message to the path passed via `--output-last-message`.

The provider surfaces this as:

1. a `response-metadata` stream part when the session is configured, then
2. a single `text-delta` with the final text right before
3. `finish`.

This is expected behavior of JSON mode in Codex exec; the AI SDK stream API is still used so your code remains compatible if richer streaming becomes available later.

## Examples

See `examples/` for runnable scripts that cover:

- Basic text generation and streaming
- Conversation history and system messages
- Permissions & sandbox modes
- JSON object generation: basic, nested, constraints, advanced

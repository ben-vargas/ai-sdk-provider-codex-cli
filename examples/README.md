# Codex CLI Provider Examples

This folder showcases how to use the AI SDK Codex CLI provider in practical scenarios. Each example is small, focused, and explains why it matters.

## Prerequisites

- Install and authenticate the Codex CLI:
  - `npm i -g @openai/codex`
  - `codex login` (ChatGPT OAuth) or set `OPENAI_API_KEY` for API auth
- Build the provider: `npm run build`

Tip: All examples set `allowNpx: true`, so they work even if `codex` is not on PATH. The provider is Node-only (it spawns a process), so run these in a Node environment (not Edge).

## How To Run

Run any example from the repo root:

```bash
npm run build
node examples/<file>.mjs
```

## Core Usage

- **basic-usage.mjs:** Minimal generation
  - Purpose: Prove setup works and show the smallest possible call.
  - Demonstrates: `generateText`, provider wiring, safe defaults.
  - Value: Quick sanity check to confirm your environment is correct.

- **basic-usage-gpt-5-codex.mjs:** Minimal generation with the new `gpt-5-codex` slug
  - Purpose: Confirm the provider works unchanged with the Codex-specific GPT-5 model ID.
  - Demonstrates: Same call path as above, but with the new slug so you can sanity check quickly.
  - Value: Handy regression test when Codex CLI ships new model identifiers.

- **streaming.mjs:** Stream responses
  - Purpose: Show the AI SDK streaming API shape.
  - Demonstrates: Reading `textStream` and rendering as chunks.
  - Value: Build responsive UIs. Note: Codex CLI JSON mode suppresses deltas, so you’ll typically receive a final chunk rather than many small ones; the pattern remains the same.

- **streaming-gpt-5-codex.mjs:** Streaming with the `gpt-5-codex` slug
  - Purpose: Validate stream handling with the Codex-specific model identifier.
  - Demonstrates: Same stream plumbing while calling the new slug.
  - Value: Confidence that streaming stays compatible across Codex model updates.

- **conversation-history.mjs:** Maintain context
  - Purpose: Keep multi-turn state using a message array.
  - Demonstrates: AI SDK message roles (`user`, `assistant`).
  - Value: Realistic chat patterns where prior turns matter.

- **system-messages.mjs:** Control behavior
  - Purpose: Use system prompts to steer tone or format.
  - Demonstrates: `system` role to enforce concise or structured replies.
  - Value: Consistency across outputs without repeating instructions.

- **system-messages-gpt-5-codex.mjs:** System prompts with `gpt-5-codex`
  - Purpose: Mirror the system prompt example against the new slug to ensure compatibility.
  - Demonstrates: That the conversation mapper/system validation still behaves the same.
  - Value: Fast compatibility regression check for future Codex CLI updates.

- **custom-config.mjs:** Configure runtime
  - Purpose: Customize CWD and autonomy/sandbox policies per run.
  - Demonstrates: `cwd`, `approvalMode`, `sandboxMode`, `fullAuto` toggles.
  - Value: Balance safety vs. friction for local dev or CI use.

- **permissions-and-sandbox.mjs:** Compare modes
  - Purpose: Understand autonomy levels and sandbox modes.
  - Demonstrates: `on-failure`, `workspace-write`, `fullAuto`, and `dangerouslyBypassApprovalsAndSandbox`.
  - Value: Pick the right guardrails for your workflow. Warning: bypass is dangerous; prefer sandboxed modes unless you fully trust the environment.

## Reliability & Operations

- **long-running-tasks.mjs:** Abort and timeouts
  - Purpose: Cancel long operations cleanly.
  - Demonstrates: `AbortController` with AI SDK calls.
  - Value: Keep apps responsive and prevent runaway tasks.

- **error-handling.mjs:** Catch and classify errors
  - Purpose: Handle auth and general failures gracefully.
  - Demonstrates: Using `isAuthenticationError`, reading provider warnings.
  - Value: User-friendly errors (e.g., suggest `codex login`) and robust UX.

- **check-cli.mjs:** Troubleshoot setup
  - Purpose: Verify Codex binary and authentication status.
  - Demonstrates: Calling `codex --version` and `codex login status` (or `npx`).
  - Value: Quick diagnosis for PATH/auth issues.

- **limitations.mjs:** Understand unsupported settings
  - Purpose: Show which AI SDK knobs are ignored by Codex.
  - Demonstrates: Warnings for temperature/topP/topK/penalties/stop sequences.
  - Value: Avoid confusion and tune your prompts instead.

## Structured Output (Objects)

**v0.2.0+**: The provider uses native `--output-schema` support with OpenAI strict mode for API-level JSON enforcement. No prompt engineering needed—schemas are passed directly to the API, eliminating 100-200 tokens per request and improving reliability.

**⚠️ Important Limitations:**

- Optional fields are **NOT supported** by OpenAI strict mode (all fields must be required)
- Format validators (`.email()`, `.url()`, `.uuid()`) are stripped (use descriptions instead)
- Pattern validators (`.regex()`) are stripped (use descriptions instead)

See [LIMITATIONS.md](../LIMITATIONS.md) for full details.

- **generate-object-basic.mjs:** Fundamentals
  - Purpose: Start with simple, typed objects.
  - Demonstrates: Zod primitives, arrays, and numeric constraints.
  - Value: Cleanly typed responses for standard data collection.
  - Note: All fields must be required (no `.optional()`).

- **generate-object-basic-gpt-5-codex.mjs:** Fundamentals with `gpt-5-codex`
  - Purpose: Exercise JSON object generation against the Codex slug.
  - Demonstrates: Same Zod-driven prompts, proving compatibility with new identifiers.
  - Value: Quick regression path when Codex CLI ships new GPT-5 model slugs.

- **generate-object-nested.mjs:** Real-world hierarchies
  - Purpose: Work with nested objects and arrays of objects.
  - Demonstrates: Organization charts, product variants, nested specs.
  - Value: Match the shape of real app payloads and APIs.

- **generate-object-constraints.mjs:** Quality and validation
  - Purpose: Enforce enums, ranges, and constraints.
  - Demonstrates: Enums, min/max numeric constraints, string length constraints.
  - Value: Higher-quality data before it enters your system.
  - Note: Use descriptions for format hints (e.g., "UUID format", "YYYY-MM-DD date") since format/pattern validators are stripped.

- **generate-object-advanced.mjs:** Complex transformations
  - Purpose: Tackle richer tasks and data extraction.
  - Demonstrates: Product comparisons with scoring, HTML-to-JSON extraction, incident classification with recommendations.
  - Value: Turn free-form inputs into structured, actionable data.

- **generate-object-native-schema.mjs:** Native schema showcase (v0.2.0+)
  - Purpose: Demonstrate native `--output-schema` capabilities with API-level enforcement.
  - Demonstrates: Complex nested schemas, enums, constraints enforced by OpenAI strict mode.
  - Value: See the power of native schema support—no prompt engineering, 100-200 fewer tokens per request, guaranteed valid JSON.

## New in v0.2.0

- **experimental-json-events.mjs:** Event format showcase
  - Purpose: Understand the new `--experimental-json` event structure.
  - Demonstrates: `session.created`, `turn.completed`, `item.completed` events, usage tracking.
  - Value: Learn the event flow for debugging and observability.

## Suggested Run Order

1. `basic-usage.mjs` → `streaming.mjs` → `conversation-history.mjs`
2. `custom-config.mjs` → `permissions-and-sandbox.mjs`
3. `generate-object-basic.mjs` → `generate-object-nested.mjs` → `generate-object-constraints.mjs` → `generate-object-advanced.mjs` → `generate-object-native-schema.mjs`
4. `experimental-json-events.mjs` (v0.2.0 event format)
5. `long-running-tasks.mjs` → `error-handling.mjs` → `limitations.mjs` → `check-cli.mjs`

## Troubleshooting

- Not getting output? Run `node examples/check-cli.mjs`.
- Auth failures? Run `codex login` or set `OPENAI_API_KEY`.
- PATH issues? Keep `allowNpx: true` or install `@openai/codex` globally.
- Streaming not “chunky”? Codex JSON mode often returns a final chunk only; the stream pattern remains correct for UIs.

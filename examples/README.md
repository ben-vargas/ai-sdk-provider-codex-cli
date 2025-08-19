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

- **streaming.mjs:** Stream responses
  - Purpose: Show the AI SDK streaming API shape.
  - Demonstrates: Reading `textStream` and rendering as chunks.
  - Value: Build responsive UIs. Note: Codex CLI JSON mode suppresses deltas, so you’ll typically receive a final chunk rather than many small ones; the pattern remains the same.

- **conversation-history.mjs:** Maintain context
  - Purpose: Keep multi-turn state using a message array.
  - Demonstrates: AI SDK message roles (`user`, `assistant`).
  - Value: Realistic chat patterns where prior turns matter.

- **system-messages.mjs:** Control behavior
  - Purpose: Use system prompts to steer tone or format.
  - Demonstrates: `system` role to enforce concise or structured replies.
  - Value: Consistency across outputs without repeating instructions.

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

The provider uses prompt engineering to enforce JSON-only responses, then extracts the first well-formed JSON block and returns it to AI SDK for Zod validation.

- **generate-object-basic.mjs:** Fundamentals
  - Purpose: Start with simple, typed objects.
  - Demonstrates: Zod primitives, arrays, and optional fields.
  - Value: Cleanly typed responses for standard data collection.

- **generate-object-nested.mjs:** Real-world hierarchies
  - Purpose: Work with nested objects and arrays of objects.
  - Demonstrates: Organization charts, product variants, nested specs.
  - Value: Match the shape of real app payloads and APIs.

- **generate-object-constraints.mjs:** Quality and validation
  - Purpose: Enforce enums, ranges, and regex formats.
  - Demonstrates: UUIDs, date regex, enum fields, min/max constraints.
  - Value: Higher-quality data before it enters your system.

- **generate-object-advanced.mjs:** Complex transformations
  - Purpose: Tackle richer tasks and data extraction.
  - Demonstrates: Product comparisons with scoring, HTML-to-JSON extraction, incident classification with recommendations.
  - Value: Turn free-form inputs into structured, actionable data.

## Suggested Run Order

1. `basic-usage.mjs` → `streaming.mjs` → `conversation-history.mjs`
2. `custom-config.mjs` → `permissions-and-sandbox.mjs`
3. `generate-object-basic.mjs` → `generate-object-nested.mjs` → `generate-object-constraints.mjs` → `generate-object-advanced.mjs`
4. `long-running-tasks.mjs` → `error-handling.mjs` → `limitations.mjs` → `check-cli.mjs`

## Troubleshooting

- Not getting output? Run `node examples/check-cli.mjs`.
- Auth failures? Run `codex login` or set `OPENAI_API_KEY`.
- PATH issues? Keep `allowNpx: true` or install `@openai/codex` globally.
- Streaming not “chunky”? Codex JSON mode often returns a final chunk only; the stream pattern remains correct for UIs.

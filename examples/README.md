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

- **basic-usage-gpt-5.1-codex.mjs:** Minimal generation with the Codex-optimized GPT-5.1 slug
  - Purpose: Confirm the provider works unchanged with the Codex-specific GPT-5.1 model ID.
  - Demonstrates: Same call path as above, but with the Codex slug so you can sanity check quickly.
  - Value: Handy regression test when Codex CLI ships new model identifiers.

- **streaming.mjs:** Stream responses
  - Purpose: Show the AI SDK streaming API shape.
  - Demonstrates: Reading `textStream` and rendering as chunks.
  - Value: Build responsive UIs. **Note:** `--experimental-json` format currently doesn't support incremental streaming—you'll receive the full response in a single chunk. The streaming API pattern is correct and will work when OpenAI adds delta event support to Codex CLI.

- **streaming-gpt-5.1-codex.mjs:** Streaming with the `gpt-5.1-codex` slug
  - Purpose: Validate stream handling with the Codex-specific model identifier.
  - Demonstrates: Same stream plumbing while calling the Codex slug.
  - Value: Confidence that streaming stays compatible across Codex model updates. **Note:** Currently delivers full response in single chunk due to experimental JSON format limitations.

- **conversation-history.mjs:** Maintain context
  - Purpose: Keep multi-turn state using a message array.
  - Demonstrates: AI SDK message roles (`user`, `assistant`).
  - Value: Realistic chat patterns where prior turns matter.

- **system-messages.mjs:** Control behavior
  - Purpose: Use system prompts to steer tone or format.
  - Demonstrates: `system` role to enforce concise or structured replies.
  - Value: Consistency across outputs without repeating instructions.

- **system-messages-gpt-5.1-codex.mjs:** System prompts with `gpt-5.1-codex`
  - Purpose: Mirror the system prompt example against the Codex slug to ensure compatibility.
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

- **advanced-settings.mjs:** Constructor-level model parameters (v0.4.0+)
  - Purpose: Demonstrate comprehensive reasoning controls and advanced Codex features at model creation.
  - Demonstrates: `reasoningEffort`, `reasoningSummary`, `webSearch`, `profile`, `mcpServers`, `rmcpClient`, and `configOverrides`. (Swap to the non-Codex `gpt-5.1` slug if you need `modelVerbosity`.)
  - Value: See all Phase 1 parameters in action—configure behavior once at construction for consistent settings across all calls.

- **provider-options.mjs:** Per-call overrides (v0.4.0+)
  - Purpose: Show how to override reasoning and config settings for individual requests.
  - Demonstrates: `providerOptions['codex-cli']` with `reasoningEffort`, `reasoningSummary`, `textVerbosity`, `mcpServers`, `rmcpClient`, and `configOverrides`.
  - Value: Tune behavior dynamically (e.g., low-effort quick checks vs. high-effort deep dives) without cloning model instances.

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

## Logging

- **logging-default.mjs:** Default logging behavior
  - Purpose: Show the default non-verbose logging mode.
  - Demonstrates: Only warn and error messages are logged, debug/info suppressed.
  - Value: Clean output for production—only essential logs appear.

- **logging-verbose.mjs:** Verbose mode for debugging
  - Purpose: Enable detailed execution logs for troubleshooting.
  - Demonstrates: All log levels (debug, info, warn, error) with full visibility.
  - Value: Development and debugging—see exactly what the provider is doing internally.

- **logging-custom-logger.mjs:** Custom logger integration
  - Purpose: Integrate with external logging systems (Winston, Pino, Datadog, etc.).
  - Demonstrates: Custom logger object with timestamps and prefixes.
  - Value: Route logs to your observability stack, format messages your way.

- **logging-disabled.mjs:** Silent operation
  - Purpose: Completely disable all provider logging.
  - Demonstrates: Setting `logger: false` for zero log output.
  - Value: Production scenarios where logs interfere with output processing.
  - Warning: No warnings or errors from the provider will be visible!

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

- **generate-object-basic-gpt-5.1-codex.mjs:** Fundamentals with `gpt-5.1-codex`
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
  - Demonstrates: `thread.started`, `turn.completed`, `item.completed` events, usage tracking.
  - Value: Learn the event flow for debugging and observability.

## Tool Streaming

**Note:** Codex CLI executes tools autonomously, so the provider sets `providerExecuted: true` on all tool calls. This means the AI SDK will not attempt to execute tools—it simply receives the results from Codex CLI.

**⚠️ Streaming Limitation:** Real-time output streaming (`output-delta` events) is not yet available. Tool outputs are delivered in the final `tool-result` event via the `aggregatedOutput` field. The provider correctly implements the AI SDK tool streaming API, but incremental stdout/stderr streaming will require additional support in Codex CLI's event format.

- **streaming-tool-calls.mjs:** Basic tool streaming
  - Purpose: Demonstrate tool streaming API with Codex CLI tool execution.
  - Demonstrates: `tool-input-start`, `tool-input-delta`, `tool-input-end`, `tool-call`, `tool-result` events for exec commands.
  - Value: See how tool invocation and results flow through the AI SDK streaming interface. Monitor what tools Codex CLI executes in real time.
  - Note: Tool outputs appear in final result, not as streaming deltas (see limitation above).

- **streaming-multiple-tools.mjs:** Multiple sequential tool calls
  - Purpose: Show complex multi-tool workflows with result tracking.
  - Demonstrates: Sequential tool execution, abbreviated output display, tool call numbering.
  - Value: Build UIs that track progress across multiple tool invocations. Great for debugging complex agent workflows.
  - Note: Shows tool inputs immediately and outputs when completed (aggregated, not streaming).

## Suggested Run Order

1. `basic-usage.mjs` → `streaming.mjs` → `conversation-history.mjs`
2. `custom-config.mjs` → `permissions-and-sandbox.mjs` → `advanced-settings.mjs` → `provider-options.mjs` (v0.4.0 features)
3. `logging-default.mjs` → `logging-verbose.mjs` → `logging-custom-logger.mjs` → `logging-disabled.mjs` (logging)
4. `generate-object-basic.mjs` → `generate-object-nested.mjs` → `generate-object-constraints.mjs` → `generate-object-advanced.mjs` → `generate-object-native-schema.mjs`
5. `experimental-json-events.mjs` (v0.2.0 event format)
6. `streaming-tool-calls.mjs` → `streaming-multiple-tools.mjs` (tool streaming)
7. `long-running-tasks.mjs` → `error-handling.mjs` → `limitations.mjs` → `check-cli.mjs`

## Troubleshooting

- Not getting output? Run `node examples/check-cli.mjs`.
- Auth failures? Run `codex login` or set `OPENAI_API_KEY`.
- PATH issues? Keep `allowNpx: true` or install `@openai/codex` globally.
- Streaming not incremental? The `--experimental-json` format (introduced Sept 25, 2025) doesn't yet support streaming deltas—you'll receive the full response in a single chunk. This is expected behavior until OpenAI adds delta event support. The streaming API pattern remains correct for future compatibility.

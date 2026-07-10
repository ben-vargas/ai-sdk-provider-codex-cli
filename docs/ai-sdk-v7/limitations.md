# Limitations

## Runtime & Architecture

- **Node.js >= 22 only** (AI SDK v7 baseline). The provider spawns a local process; Edge runtimes are not supported.
- **ESM-only.** Version 2.x ships no CommonJS build; `require('ai-sdk-provider-codex-cli')` fails. Use `import` from ESM (`"type": "module"` or `.mjs`).
- Model catalogs drift: model slugs are owned by Codex/OpenAI and change with the installed Codex CLI. Use `listModels()` / `provider.listModels()` instead of assuming a slug exists.

## Prompt & File Inputs

The provider implements the AI SDK v7 (spec v4) prompt shapes with these constraints:

- **Images only.** `{ type: 'file' }` parts are supported when `mediaType` is `image/*` (or the top-level segment `'image'`). Non-image files produce an `unsupported` warning and are skipped.
- **Tagged file data** (`data.type: 'data' | 'url' | 'text' | 'reference'`) is understood:
  - `'data'` (bytes, base64, `data:` URLs) → written to a temp file and passed to Codex (`--image` for exec, `localImage` for app-server); temp files are cleaned up after each request.
  - `'url'`: both providers declare `supportedUrls = {}`, so the AI SDK **downloads remote `https://` URLs itself** and delivers inline data to the provider — remote images therefore work end to end through the temp-file path. Raw HTTP URL shapes that reach the exec provider directly (bypassing SDK download) produce an `unsupported` warning; `file://` URLs are rejected with a warning in both modes.
  - `'text'` and `'reference'` data are not supported for images (warning, skipped).
- **`custom` parts** (assistant prompt or tool-result content) are not supported: the provider emits an `unsupported` warning and skips them.
- **`reasoning-file` parts** are not supported: warning, skipped.
- **Tool-result file content** uses the v7 canonical `{ type: 'file', mediaType, data: { ... } }` shape. Because Codex prompts are text transcripts, these are rendered as text markers (`[image-data: image/png]`, `[file-url: ...]`, `[file-id]`, or inline text for `data.type: 'text'`) rather than re-uploaded as binary inputs.

## Streaming Behavior

- **`codexExec`:** Codex `--experimental-json` mode emits events (`thread.started`, `turn.completed`, `item.completed`) rather than streaming text deltas; streaming returns the final text in a single chunk. The CLI provides the final assistant content in the `item.completed` event, which this provider reads and emits at the end.
- **`codexAppServer`:** true incremental deltas via `item/agentMessage/delta`; `streamText()` emits progressively.

## Tools & Tool Streaming

- Codex executes its **own** tools (exec, patch, web_search, MCP tools) autonomously; tool calls/results stream in real time with `providerExecuted: true`, and runtime/provider tools are marked `dynamic: true`.
- **AI SDK-defined tools are not forwarded to Codex.** Passing `tools` / `toolChoice` in a call produces `unsupported` warnings; Codex CLI has no way to call back into SDK tool implementations. Use Codex MCP servers (including `createSdkMcpServer()` in app-server mode) to expose your own capabilities instead.
- Real-time tool _output_ streaming is limited: exec mode delivers tool output in the final `tool-result` event (`aggregatedOutput`); app-server mode surfaces output deltas only when Codex emits delta notifications.

## JSON Schema

- **Optional fields NOT supported**: OpenAI strict mode requires all fields to be required (no `.optional()`)
- **Format validators stripped**: `.email()`, `.url()`, `.uuid()` are removed during sanitization (use descriptions instead)
- **Pattern validators stripped**: `.regex()` is removed during sanitization (use descriptions instead)
- See [LIMITATIONS.md](../../LIMITATIONS.md) at repo root for comprehensive details

## AI SDK Parameter Support

Some AI SDK parameters are not applicable to Codex CLI and are ignored with an `unsupported` warning: `temperature`, `topP`, `topK`, `maxOutputTokens`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`, plus `tools` / `toolChoice` as described above.

The top-level `reasoning` option **is** supported and maps to Codex reasoning effort; provider-specific options take precedence — see [configuration.md](./configuration.md#reasoning-precedence).

## Model Parameter Validation

**Known API quirks (exec mode):**

### reasoningSummary Parameter

The OpenAI Responses API has misleading error messages for the `reasoningSummary` parameter:

- **Valid values:** `'auto'`, `'detailed'`
- **Invalid values:** `'concise'`, `'none'` (rejected with 400 errors)

**The quirk:** When you pass an invalid value like `'none'`, the API error claims valid values are `'concise', 'detailed', and 'auto'`. However, if you then try `'concise'`, the API rejects it as unsupported for the model.

This provider's exec-mode types and validation only allow `'auto'` and `'detailed'` to prevent runtime errors. (The app-server protocol's `summary` setting accepts `'auto' | 'concise' | 'detailed' | 'none'`.)

## Sessions

- App-server persistent threads (`threadMode: 'persistent'`, `threadId`, `resume`) keep context server-side, but they are **not** a transcript store: there is no fork, resume-at-message, or checkpoint/rewind capability in the Codex app-server protocol.

## Observability

- Token usage is reported per call; with AI SDK v7, `result.usage` aggregates **all steps** (use `result.finalStep.usage` for final-step-only numbers).
- Detailed fields live under `usage.inputTokenDetails` (e.g. `cacheReadTokens`) and `usage.outputTokenDetails` (e.g. `reasoningTokens`); the legacy top-level `cachedInputTokens` / `reasoningTokens` aliases were removed by AI SDK 7.
- Codex-specific metadata (e.g. `threadId`) is exposed at `result.finalStep.providerMetadata['codex-app-server']` / `['codex-cli']`.

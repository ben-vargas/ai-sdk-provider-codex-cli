# Known Limitations

This document covers the 2.x package line (AI SDK v7) and applies to both provider modes — `codexExec` and `codexAppServer` — except where a mode is called out explicitly. For a condensed overview, see [docs/ai-sdk-v7/limitations.md](docs/ai-sdk-v7/limitations.md).

## Native JSON Schema Support

Structured output (`generateObject`, `streamObject`, and `responseFormat: { type: 'json' }`) is implemented with OpenAI's strict-mode output schemas. The provider sanitizes your JSON schema and passes it to Codex — via `--output-schema` in exec mode and the `outputSchema` turn parameter in app-server mode. Strict mode imposes the constraints below in both modes.

### Optional Fields Not Supported

**OpenAI's strict mode does not support optional fields.** All properties in the schema must be in the `required` array.

**Impact:**

- Zod schemas with `.optional()` fields will cause OpenAI API errors
- The API will return 400 Bad Request with message: "required is required to be supplied and to be an array including every key in properties"

**Workaround:**

- Make all fields required in your Zod schema
- Use descriptions to indicate which fields might be empty/null
- Handle optional logic in your application code after receiving the response

**Example that will NOT work:**

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().optional(), // ❌ Will cause API error
});
```

**Example that WILL work:**

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string(), // ✅ All fields required
});
```

### Schema Sanitization

The provider automatically sanitizes JSON schemas to remove fields not supported by OpenAI's strict mode:

**Removed fields:**

- `$schema` - JSON Schema metadata
- `$id`, `$ref`, `$defs`, `definitions` - Schema references
- `title`, `examples` - Documentation fields (at schema level, property names are preserved)
- `default` - Default values
- `format` - String format validators (e.g., `email`, `uuid`, `url`)
- `pattern` - Regex patterns

**Supported:**

- `minimum`, `maximum` - Numeric constraints
- `minLength`, `maxLength` - String length constraints
- `minItems`, `maxItems` - Array length constraints
- `enum` - Enumerated values
- `type`, `properties`, `required`, `items` - Core schema fields
- `description` - Field descriptions

**Important:** Property names like "title", "format", etc. are preserved - only schema metadata fields are removed.

### No Format/Pattern Validation

Since `format` and `pattern` fields are removed during sanitization:

- Email format (`.email()`) not enforced by API
- URL format (`.url()`) not enforced by API
- UUID format (`.uuid()`) not enforced by API
- Regex patterns (`.regex()`) not enforced by API

**Workaround:** Use descriptions to guide the model, and validate in your application code:

```typescript
const schema = z.object({
  email: z.string().describe('Valid email address'),
  website: z.string().describe('Full URL starting with https://'),
  id: z.string().describe('UUID v4 format'),
});
```

## Other Limitations

### Image Support

The provider supports multimodal (image) inputs with these characteristics:

**Supported input forms:**

- Base64 data URLs (`data:image/png;base64,...`)
- Raw base64 strings
- `Buffer` / `Uint8Array` / `ArrayBuffer`
- Remote `https://` URLs — both providers declare `supportedUrls = {}`, so the AI SDK downloads the image itself and delivers inline data to the provider; remote images work end to end through the temp-file path below
- AI SDK v7 tagged file data (`{ type: 'data' | 'url' }`)

**Not supported:**

- `file://` URLs — rejected with an `unsupported` warning in both modes
- Non-image `{ type: 'file' }` parts — skipped with an `unsupported` warning
- Tagged `'text'` and `'reference'` file data for images — skipped with a warning
- Raw HTTP(S) URL shapes that reach the exec provider directly, bypassing the AI SDK's download step — these produce an `unsupported` warning

**How it works:**

- Image bytes are written to temporary files
- Passed to Codex via the `--image` flag (exec mode) or as `localImage` inputs (app-server mode)
- Temp files are automatically cleaned up after the request completes

### Usage Tracking

Both modes report real token usage from Codex events (`turn.completed` in exec mode, `thread/tokenUsage/updated` notifications in app-server mode), including cached input tokens.

Notes:

- With AI SDK v7, `result.usage` aggregates **all steps**; use `result.finalStep.usage` for final-step-only numbers.
- Detailed fields live under `usage.inputTokenDetails` (e.g. `cacheReadTokens`) and `usage.outputTokenDetails` (e.g. `reasoningTokens`); the legacy top-level `cachedInputTokens` / `reasoningTokens` aliases were removed by AI SDK 7.
- If Codex omits usage data for a turn, the provider reports zeros rather than failing.

### Streaming

Streaming granularity differs by mode:

- **`codexAppServer` (recommended for streaming):** true incremental text deltas via `item/agentMessage/delta` notifications — `streamText()` emits progressively.
- **`codexExec`:** Codex's `--experimental-json` output emits events (`thread.started`, `turn.completed`, `item.completed`) rather than text deltas, so `streamText()` works functionally but delivers the full response in a single chunk once generation completes. The provider reads the final assistant text from the `item.completed` event.

Tool calls and results stream in real time in both modes (with `providerExecuted: true`), but tool _output_ streaming is limited: exec mode delivers tool output in the final `tool-result` event, and app-server mode surfaces output deltas only when Codex emits delta notifications.

If OpenAI adds delta events to the exec JSON output format, this provider will surface them in exec mode as well.

### Unsupported AI SDK Parameters

Codex CLI does not accept sampling and generation-control parameters. The provider ignores these with an `unsupported` warning: `temperature`, `topP`, `topK`, `maxOutputTokens`, `presencePenalty`, `frequencyPenalty`, `stopSequences`, `seed`.

AI SDK-defined `tools` / `toolChoice` are also not forwarded — Codex executes its own tools (exec, patch, web_search, MCP tools) autonomously and cannot call back into SDK tool implementations. (`toolChoice: 'auto'` is ignored without a warning, since AI SDK v7 sends it by default.) Use Codex MCP servers (including `createSdkMcpServer()` in app-server mode) to expose your own capabilities instead.

The top-level `reasoning` call option **is** supported and maps to Codex reasoning effort in both modes; see [docs/ai-sdk-v7/configuration.md](docs/ai-sdk-v7/configuration.md#reasoning-precedence).

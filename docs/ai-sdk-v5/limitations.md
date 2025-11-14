# Limitations

## Runtime & Architecture

- Node.js runtime only (spawns a local process); Edge runtimes are not supported.
- Image inputs are not supported.

## Streaming Behavior

- Codex `--experimental-json` mode emits events (`thread.started`, `turn.completed`, `item.completed`) rather than streaming text deltas; streaming usually returns a final chunk. The CLI provides the final assistant content in the `item.completed` event, which this provider reads and emits at the end.

## Tool Streaming (v0.3.0+)

- Tool streaming is fully supported - tool invocation and result events are emitted in real-time
- **Limitation:** Real-time output streaming (`output-delta` events) not yet available. Tool outputs are delivered in the final `tool-result` event via `aggregatedOutput` field, not as incremental deltas during tool execution
- This limitation exists because Codex CLI's experimental JSON format doesn't currently emit incremental output events during tool execution

## JSON Schema (v0.2.0+)

- **Optional fields NOT supported**: OpenAI strict mode requires all fields to be required (no `.optional()`)
- **Format validators stripped**: `.email()`, `.url()`, `.uuid()` are removed during sanitization (use descriptions instead)
- **Pattern validators stripped**: `.regex()` is removed during sanitization (use descriptions instead)
- See [LIMITATIONS.md](../../LIMITATIONS.md) at repo root for comprehensive details

## AI SDK Parameter Support

- Some AI SDK parameters are not applicable to Codex CLI (e.g., temperature, topP, penalties). The provider surfaces warnings and ignores them.

## Model Parameter Validation (v0.4.0+)

**Known API Quirks:**

### reasoningSummary Parameter

The OpenAI Responses API has misleading error messages for the `reasoningSummary` parameter:

- **Valid values:** `'auto'`, `'detailed'`
- **Invalid values:** `'concise'`, `'none'` (rejected with 400 errors)

**The quirk:** When you pass an invalid value like `'none'`, the API error claims valid values are `'concise', 'detailed', and 'auto'`. However, if you then try `'concise'`, the API rejects it with: `"Unsupported value: 'concise' is not supported with the 'gpt-5.1-codex' model."`

This provider's type system and validation only allow `'auto'` and `'detailed'` to prevent runtime errors.

## Observability

- Token usage tracking is available via `turn.completed` events (requires Codex CLI >= 0.44.0)
- Earlier versions (< 0.44.0) will report 0 for all token counts

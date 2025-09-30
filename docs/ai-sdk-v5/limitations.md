# Limitations

## Runtime & Architecture

- Node.js runtime only (spawns a local process); Edge runtimes are not supported.
- Image inputs are not supported.

## Streaming Behavior

- Codex `--experimental-json` mode emits events (`session.created`, `turn.completed`, `item.completed`) rather than streaming text deltas; streaming usually returns a final chunk. The CLI provides the final assistant content in the `item.completed` event, which this provider reads and emits at the end.

## JSON Schema (v0.2.0+)

- **Optional fields NOT supported**: OpenAI strict mode requires all fields to be required (no `.optional()`)
- **Format validators stripped**: `.email()`, `.url()`, `.uuid()` are removed during sanitization (use descriptions instead)
- **Pattern validators stripped**: `.regex()` is removed during sanitization (use descriptions instead)
- See [LIMITATIONS.md](../../LIMITATIONS.md) at repo root for comprehensive details

## AI SDK Parameter Support

- Some AI SDK parameters are not applicable to Codex CLI (e.g., temperature, topP, penalties). The provider surfaces warnings and ignores them.

## Observability

- Token usage is not currently exposed by Codex events in `--experimental-json` mode.

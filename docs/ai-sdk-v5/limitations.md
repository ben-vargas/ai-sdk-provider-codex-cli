# Limitations

- Node.js runtime only (spawns a local process); Edge runtimes are not supported.
- Codex JSON mode (`codex exec --json`) suppresses mid‑response deltas; streaming usually returns a final chunk. The CLI writes the final assistant content via `--output-last-message`, which this provider reads and emits at the end.
- Some AI SDK parameters are not applicable to Codex CLI (e.g., temperature, topP, penalties). The provider surfaces warnings and ignores them.
- Image inputs are not supported.
- Token usage is not currently exposed by Codex JSONL events in `exec` mode.
- The provider reads the final assistant message through `--output-last-message` for reliability.

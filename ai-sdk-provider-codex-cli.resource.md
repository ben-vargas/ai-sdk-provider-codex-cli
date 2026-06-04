# AI SDK Provider Codex CLI Fork

Backspace fork of the community AI SDK v6 provider for OpenAI Codex CLI.

## Owns

- `createCodexAppServer` and app-server language model behavior.
- Provider settings, provider options, and Codex JSON-RPC parameter mapping.
- Generated package output under `dist/` from `npm run build`.

## Consumed By

- `apps/agent` through a local `file:` dependency.

## Backspace-Specific Behavior

- Preserves `serviceTier` in app-server settings and per-call provider options.
- Sends `serviceTier` through `thread/start`, `thread/resume`, and `turn/start`.
- Leaves app-bundled Codex runtime resolution to `apps/agent`.

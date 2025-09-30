# Troubleshooting

## "codex not found" / CLI not on PATH

- Install globally: `npm i -g @openai/codex`
- Or enable fallback: `{ allowNpx: true }` (uses `npx -y @openai/codex`)

## Not authenticated / 401 / "Please login"

- Run `codex login`
- Ensure `~/.codex/auth.json` exists and is readable
- Alternatively set `OPENAI_API_KEY` in `env`

## Sandbox / approval errors

- Use safer defaults for non‑interactive runs:
  - `approvalMode: 'on-failure'`
  - `sandboxMode: 'workspace-write'`
  - `skipGitRepoCheck: true`
- For fully autonomous flows: `fullAuto: true` (be cautious). Avoid `dangerouslyBypassApprovalsAndSandbox` unless the environment is already sandboxed.

## Streaming emits only a final chunk

- Codex `--experimental-json` mode emits events (`session.created`, `turn.completed`, `item.completed`) rather than streaming text deltas; the provider still uses AI SDK's standard stream API. This is expected.

## Object generation fails with empty response

**v0.2.0+**: The provider uses native `--output-schema` with OpenAI strict mode. Common issues:

- **Optional fields**: Remove all `.optional()` calls - OpenAI strict mode requires all fields
- **Format validators**: Remove `.email()`, `.url()`, `.uuid()` - use descriptions like "Valid email address" or "UUID format" instead
- **Pattern validators**: Remove `.regex()` - use descriptions like "YYYY-MM-DD format" instead

See [LIMITATIONS.md](../../LIMITATIONS.md) for full details.

## zod v3/v4 compatibility warnings

- NPM warnings may appear due to transitive peers (e.g., `zod-to-json-schema`). They do not affect functionality. The provider works with `zod@^3` and `^4`.

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

- Codex JSON mode suppresses deltas; the provider still uses AI SDK’s standard stream API. This is expected.

## Object generation produces extra text

- The provider enforces JSON‑only via prompt engineering and then extracts the first balanced JSON block. Ensure your schema is clear and constraints are realistic.

## zod v3/v4 compatibility warnings

- NPM warnings may appear due to transitive peers (e.g., `zod-to-json-schema`). They do not affect functionality. The provider works with `zod@^3` and `^4`.

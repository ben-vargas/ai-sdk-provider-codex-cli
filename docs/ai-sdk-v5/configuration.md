# Configuration Reference

This provider wraps the `codex exec` CLI in non‑interactive mode and maps settings to CLI flags/config overrides.

## Settings

- `allowNpx` (boolean): If true, runs `npx -y @openai/codex` when Codex isn’t found on PATH.
- `codexPath` (string): Explicit path to Codex JS entry (`bin/codex.js`), bypassing PATH resolution.
- `cwd` (string): Working directory for the spawned process.
- `color` ('always' | 'never' | 'auto'): Controls ANSI color emission.
- `skipGitRepoCheck` (boolean): When true, passes `--skip-git-repo-check`.
- `fullAuto` (boolean): Sets `--full-auto` (low-friction sandboxed execution).
- `dangerouslyBypassApprovalsAndSandbox` (boolean): Maps to `--dangerously-bypass-approvals-and-sandbox`.
- `approvalMode` ('untrusted' | 'on-failure' | 'on-request' | 'never'): Applied via `-c approval_policy=...`.
- `sandboxMode` ('read-only' | 'workspace-write' | 'danger-full-access'): Applied via `-c sandbox_mode=...`.
- `outputLastMessageFile` (string): File path to write the last agent message. If omitted, a temp file is created.
- `env` (Record<string,string>): Extra env vars for the child process (e.g., `OPENAI_API_KEY`).
- `logger` (custom | false): Custom logger or disable logging entirely.

## Defaults & Recommendations

- Non‑interactive defaults:
  - `approvalMode: 'on-failure'`
  - `sandboxMode: 'workspace-write'`
  - `skipGitRepoCheck: true`
- For strict automation in controlled environments:
  - `fullAuto: true` OR `dangerouslyBypassApprovalsAndSandbox: true` (be careful!)

## Flag Mapping

- `approvalMode` → `-c approval_policy=<mode>`
- `sandboxMode` → `-c sandbox_mode=<mode>`
- `skipGitRepoCheck` → `--skip-git-repo-check`
- `fullAuto` → `--full-auto`
- `dangerouslyBypassApprovalsAndSandbox` → `--dangerously-bypass-approvals-and-sandbox`
- `color` → `--color <always|never|auto>`
- `outputLastMessageFile` → `--output-last-message <path>`

## JSON Mode (v0.2.0+)

When the AI SDK request uses `responseFormat: { type: 'json' }`, the provider:

1. Converts your Zod schema to JSON Schema format
2. Sanitizes the schema (removes unsupported fields like `format`, `pattern`, `$schema`, etc.)
3. Passes the schema via `--output-schema` for native OpenAI strict mode enforcement
4. The API returns guaranteed valid JSON matching your schema
5. AI SDK validates the response with Zod

**Breaking change from v0.1.x**: No longer uses prompt engineering. Schemas are enforced at the API level using OpenAI strict mode, which does not support optional fields or format validators.

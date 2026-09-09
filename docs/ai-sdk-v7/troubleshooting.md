# Troubleshooting

## "codex not found" / CLI not on PATH

- Install globally: `npm i -g @openai/codex`
- Or enable fallback: `{ allowNpx: true }` (uses `npx -y @openai/codex`)
- Or point at a specific binary: `{ codexPath: '/opt/homebrew/bin/codex' }`

## Not authenticated / 401 / "Please login"

- Run `codex login`
- Ensure `~/.codex/auth.json` exists and is readable
- Alternatively set `OPENAI_API_KEY` in `env`

## `ERR_REQUIRE_ESM` / "require() of ES Module not supported"

Version 2.x is ESM-only (as is AI SDK v7). `require('ai-sdk-provider-codex-cli')` cannot work.

- Use `import` syntax and either add `"type": "module"` to your `package.json` or rename files to `.mjs`
- From CommonJS you can use a dynamic import: `const { codexExec } = await import('ai-sdk-provider-codex-cli');`
- If you cannot move to ESM/Node 22, stay on the v6-compatible 1.x line: `npm i ai@^6 ai-sdk-provider-codex-cli@ai-sdk-v6`

## Syntax errors or engine warnings on startup

- Node.js **22 or later** is required (`engines.node: ">=22"`); AI SDK v7 no longer supports Node 18/20. Check with `node --version`.

## AI SDK error: system messages in `messages` rejected

AI SDK 7 rejects `{ role: 'system' }` entries inside `prompt`/`messages` by default — this commonly surfaces with persisted v6 chat histories.

- Preferred: move the system text to the top-level `instructions` option
- For trusted, server-controlled histories only: pass `allowSystemInMessages: true`

See [migration-v6-to-v7.md](./migration-v6-to-v7.md#system-messages) for examples.

## Model not found / unexpected model errors

Model slugs are owned by Codex/OpenAI and drift with the installed CLI. Don't guess:

```js
import { listModels } from 'ai-sdk-provider-codex-cli';
const { models, defaultModel } = await listModels();
console.log(
  defaultModel?.id,
  models.map((m) => m.id),
);
```

Also check `codex --version`; upgrading the CLI (`npm i -g @openai/codex@latest`) changes the available models.

## Sandbox / approval errors

- Use safer defaults for non‑interactive runs:
  - `approvalMode: 'on-request'`
  - `sandboxMode: 'workspace-write'`
  - `skipGitRepoCheck: true` (exec)
- For fully autonomous flows: `sandboxMode: 'workspace-write'` (the deprecated `fullAuto: true` maps to the same thing since Codex CLI 0.147 removed `--full-auto`). Avoid `dangerouslyBypassApprovalsAndSandbox` unless the environment is already sandboxed.
- App-server: Codex-native approval requests (commands, file changes, skills, MCP elicitations) need a `serverRequests` handler or `autoApprove: true`; otherwise the provider answers with its default policy and your turn may be blocked from doing what you expected.

## Streaming emits only a final chunk

- `codexExec` mode: expected — `codex exec --experimental-json` emits completed-item events, not deltas. The provider still uses AI SDK's standard stream API.
- For true incremental streaming, use `codexAppServer`.
- Reading the full event stream? In AI SDK v7 it's `result.stream` (`fullStream` is a deprecated alias).

## Process seems to hang after my script finishes

The app-server provider keeps a shared `codex app-server` process alive between calls. Call `await provider.close()` (or `dispose()`) when done, or set `idleTimeoutMs` so the process exits after inactivity.

## Remote image URLs

- Pass remote images as `{ type: 'file', data: new URL('https://...'), mediaType: 'image/png' }` message parts. The provider declares `supportedUrls = {}`, so the AI SDK downloads the URL and the provider forwards the bytes via a temp file.
- `file://` URLs are not supported (warning). Exec mode warns on raw HTTP URL shapes that bypass the SDK's download step.

## Object generation fails with empty response

The provider uses native `--output-schema` / `outputSchema` with OpenAI strict mode. Common issues:

- **Optional fields**: Remove all `.optional()` calls - OpenAI strict mode requires all fields
- **Format validators**: Remove `.email()`, `.url()`, `.uuid()` - use descriptions like "Valid email address" or "UUID format" instead
- **Pattern validators**: Remove `.regex()` - use descriptions like "YYYY-MM-DD format" instead

See [LIMITATIONS.md](../../LIMITATIONS.md) for full details.

## My AI SDK tools never run

Codex executes its own tools and cannot call back into AI SDK `tools` definitions; the provider warns and ignores `tools`/`toolChoice`. Expose custom capabilities as MCP servers instead (`mcpServers`, or `createSdkMcpServer()` in app-server mode). See [limitations.md](./limitations.md#tools--tool-streaming).

## zod v4 requirement

- The peer range is `zod@^4.1.8` only. Zod 3 is not supported: importing under Zod 3 throws because `.refine().passthrough()` is unavailable on Zod 3's `ZodEffects`. Upgrade to Zod 4 if `npm i` reports an unmet peer.
- NPM warnings from transitive peers do not affect functionality.

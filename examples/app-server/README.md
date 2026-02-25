# App-Server Examples

These examples use `createCodexAppServer` and a persistent `codex app-server` JSON-RPC process.

## Notes

- Best for higher-throughput or stateful workflows.
- Stateful continuation uses `providerOptions['codex-app-server'].threadId`.
- Server-initiated JSON-RPC requests can be handled with `serverRequests`.
- Requires Codex CLI `>= 0.105.0`.

## Thread Lifecycle

- No `threadId` provided:
  - The provider starts an ephemeral thread for the call.
  - It returns the generated `threadId` in `providerMetadata['codex-app-server'].threadId`.
- `threadId` provided:
  - The provider resumes that thread and appends the new user turn.
  - Use this for multi-turn memory across separate `generateText`/`streamText` calls.
- Server restart / stale thread:
  - A previously returned `threadId` can become invalid after app-server restarts.
  - In that case, start a new conversation by omitting `threadId`.
- `persistExtendedHistory`:
  - Can be enabled in default settings or provider options when you want longer retained history semantics.

## Lifecycle Requirement

Always close the provider when finished:

```js
const provider = createCodexAppServer();
try {
  // calls...
} finally {
  await provider.close();
}
```

Not closing can leave a child `codex app-server` process running longer than expected.

## Integration Env Vars

For the repository's app-server smoke test (`src/__tests__/app-server-integration.smoke.test.ts`):

- `CODEX_APP_SERVER_INTEGRATION=1`
  - Enables the integration smoke test (otherwise it is skipped).
- `CODEX_APP_SERVER_INTEGRATION_CODEX_PATH`
  - Optional path to a specific Codex CLI binary/script to use for the test.
- `CODEX_APP_SERVER_INTEGRATION_MODEL`
  - Optional model override (defaults to `gpt-5.3-codex`).

Example:

```bash
CODEX_APP_SERVER_INTEGRATION=1 \
CODEX_APP_SERVER_INTEGRATION_MODEL=gpt-5.3-codex \
npx vitest run src/__tests__/app-server-integration.smoke.test.ts
```

## Run

```bash
npm run build
node examples/app-server/basic-usage.mjs
node examples/app-server/conversation-history.mjs
node examples/app-server/list-models.mjs
node examples/app-server/session-injection.mjs
node examples/app-server/local-mcp-tool.mjs
node examples/app-server/abort.mjs
node examples/app-server/raw-chunks.mjs
node examples/app-server/usage-metadata.mjs
```

## Validation

- `node examples/app-server/check-cli.mjs` checks install/auth, verifies `app-server --help`, and performs a minimal app-server generation call.
- `npm run validate:examples:app-server` executes all app-server examples and validates expected output rules from `examples/app-server/expectations.json`.

# Codex Provider Examples

This directory contains 1:1 paired examples for both provider modes:

- `examples/exec/`: `codexExec` / `createCodexExec` (`codex exec`, process-per-call)
- `examples/app-server/`: `createCodexAppServer` (`codex app-server`, persistent JSON-RPC)
- `examples/assets/`: shared files used by examples (for example, `bull.webp`)

Provider-specific notes:

- [Exec Notes](./exec/README.md)
- [App-Server Notes](./app-server/README.md)

## Prerequisites

- Install Codex CLI and authenticate:
  - `npm i -g @openai/codex`
  - `codex login` (or set `OPENAI_API_KEY`)
- Build this package before running examples: `npm run build`
- App-server examples require Codex CLI `>= 0.105.0`.

## Run

```bash
npm run build
node examples/exec/basic-usage.mjs
node examples/app-server/basic-usage.mjs
node examples/app-server/list-models.mjs
node examples/app-server/abort.mjs
node examples/app-server/raw-chunks.mjs
node examples/app-server/usage-metadata.mjs
```

## Validate

```bash
npm run validate:docs
npm run validate:examples:app-server
```

## Parity Table

| Basename                            | Exec                                              | App-Server                                              |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------------- |
| `advanced-settings.mjs`             | `examples/exec/advanced-settings.mjs`             | `examples/app-server/advanced-settings.mjs`             |
| `basic-usage.mjs`                   | `examples/exec/basic-usage.mjs`                   | `examples/app-server/basic-usage.mjs`                   |
| `check-cli.mjs`                     | `examples/exec/check-cli.mjs`                     | `examples/app-server/check-cli.mjs`                     |
| `cmdline-limit-test.mjs`            | `examples/exec/cmdline-limit-test.mjs`            | `examples/app-server/cmdline-limit-test.mjs`            |
| `conversation-history.mjs`          | `examples/exec/conversation-history.mjs`          | `examples/app-server/conversation-history.mjs`          |
| `custom-config.mjs`                 | `examples/exec/custom-config.mjs`                 | `examples/app-server/custom-config.mjs`                 |
| `error-handling.mjs`                | `examples/exec/error-handling.mjs`                | `examples/app-server/error-handling.mjs`                |
| `experimental-json-events.mjs`      | `examples/exec/experimental-json-events.mjs`      | `examples/app-server/experimental-json-events.mjs`      |
| `generate-object-advanced.mjs`      | `examples/exec/generate-object-advanced.mjs`      | `examples/app-server/generate-object-advanced.mjs`      |
| `generate-object-basic.mjs`         | `examples/exec/generate-object-basic.mjs`         | `examples/app-server/generate-object-basic.mjs`         |
| `generate-object-constraints.mjs`   | `examples/exec/generate-object-constraints.mjs`   | `examples/app-server/generate-object-constraints.mjs`   |
| `generate-object-native-schema.mjs` | `examples/exec/generate-object-native-schema.mjs` | `examples/app-server/generate-object-native-schema.mjs` |
| `generate-object-nested.mjs`        | `examples/exec/generate-object-nested.mjs`        | `examples/app-server/generate-object-nested.mjs`        |
| `image-support.mjs`                 | `examples/exec/image-support.mjs`                 | `examples/app-server/image-support.mjs`                 |
| `limitations.mjs`                   | `examples/exec/limitations.mjs`                   | `examples/app-server/limitations.mjs`                   |
| `logging-custom-logger.mjs`         | `examples/exec/logging-custom-logger.mjs`         | `examples/app-server/logging-custom-logger.mjs`         |
| `logging-default.mjs`               | `examples/exec/logging-default.mjs`               | `examples/app-server/logging-default.mjs`               |
| `logging-disabled.mjs`              | `examples/exec/logging-disabled.mjs`              | `examples/app-server/logging-disabled.mjs`              |
| `logging-verbose.mjs`               | `examples/exec/logging-verbose.mjs`               | `examples/app-server/logging-verbose.mjs`               |
| `long-prompt-test.mjs`              | `examples/exec/long-prompt-test.mjs`              | `examples/app-server/long-prompt-test.mjs`              |
| `long-running-tasks.mjs`            | `examples/exec/long-running-tasks.mjs`            | `examples/app-server/long-running-tasks.mjs`            |
| `permissions-and-sandbox.mjs`       | `examples/exec/permissions-and-sandbox.mjs`       | `examples/app-server/permissions-and-sandbox.mjs`       |
| `provider-options.mjs`              | `examples/exec/provider-options.mjs`              | `examples/app-server/provider-options.mjs`              |
| `streaming-multiple-tools.mjs`      | `examples/exec/streaming-multiple-tools.mjs`      | `examples/app-server/streaming-multiple-tools.mjs`      |
| `streaming-tool-calls.mjs`          | `examples/exec/streaming-tool-calls.mjs`          | `examples/app-server/streaming-tool-calls.mjs`          |
| `streaming.mjs`                     | `examples/exec/streaming.mjs`                     | `examples/app-server/streaming.mjs`                     |
| `system-messages.mjs`               | `examples/exec/system-messages.mjs`               | `examples/app-server/system-messages.mjs`               |

## App-Server-Only Examples

These demonstrate features that only exist in `codex app-server` mode:

- `examples/app-server/list-models.mjs` - calls `listModels()`
- `examples/app-server/session-injection.mjs` - uses `onSessionCreated` + `session.injectMessage()`
- `examples/app-server/local-mcp-tool.mjs` - registers in-process tools with `createSdkMcpServer()` (loopback-bound + bearer-auth local MCP transport)
- `examples/app-server/abort.mjs` - demonstrates aborting an in-flight stream with `AbortController`
- `examples/app-server/raw-chunks.mjs` - enables `includeRawChunks` and inspects raw protocol events
- `examples/app-server/usage-metadata.mjs` - prints token usage and provider metadata from a generation

## Troubleshooting

- CLI/auth checks: `node examples/exec/check-cli.mjs` or `node examples/app-server/check-cli.mjs`
- Build issues: run `npm run build`
- App-server lifecycle: always close the provider (`await provider.close()`) after use.

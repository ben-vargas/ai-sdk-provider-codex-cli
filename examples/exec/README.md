# Exec Examples

These examples use `codexExec` / `createCodexExec` and spawn a fresh `codex exec` process per request.

## Notes

- Best for stateless request/response workloads.
- No explicit provider lifecycle management is needed.
- Use `providerOptions['codex-cli']` for per-call overrides.
- Streaming API is supported, but text/tool output may arrive as aggregated chunks depending on Codex event support.

## Run

```bash
npm run build
node examples/exec/basic-usage.mjs
node examples/exec/streaming.mjs
```

## Validation

- `node examples/exec/check-cli.mjs` checks CLI install and auth status.

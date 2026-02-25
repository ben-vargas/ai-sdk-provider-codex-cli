# App-Server V2 Migration

This migration applies to `createCodexAppServer` users.

> Note: the app-server integration is currently pre-release in this repository. Architectural correctness and stability take precedence over backward compatibility until first public app-server release.

## API changes

- `requestHandlers` -> `serverRequests`
- `approvalMode` -> `approvalPolicy`
- `sandboxMode` -> `sandboxPolicy`
- `reasoningEffort` -> `effort`
- `reasoningSummary` -> `summary`
- standalone model discovery helper: `listModels()`

Legacy app-server alias keys are now rejected by validation.

## New settings and behavior

- `includeRawChunks` can now be configured at provider default settings level and overridden per-call.
- Tool execution stats are included in finish metadata:
  - `providerMetadata['codex-app-server'].toolExecutionStats`
- `listModels()` now throws `UnsupportedFeatureError` if the connected app-server does not support `model/list`.

## Example migration

Before:

```ts
const provider = createCodexAppServer({
  defaultSettings: {
    approvalMode: 'on-failure',
    sandboxMode: 'workspace-write',
    requestHandlers: {
      onDynamicToolCall: async () => ({ contentItems: [], success: true }),
    },
  },
});
```

After:

```ts
const provider = createCodexAppServer({
  defaultSettings: {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
    serverRequests: {
      onDynamicToolCall: async () => ({ contentItems: [], success: true }),
    },
  },
});
```

## Notes

- Thread behavior remains `stateless` by default.
- Explicit `providerOptions['codex-app-server'].threadId` still takes precedence over automatic persistent-thread reuse.

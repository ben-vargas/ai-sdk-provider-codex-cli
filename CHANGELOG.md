# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-02-27

### Added

- **App-server v2 architecture** (`createCodexAppServer`) with persistent JSON-RPC lifecycle and dedicated internal modules:
  - `AppServerRpcClient` for process management, handshake/version validation, request correlation, reconnect/idle-timeout behavior, and server-request dispatch
  - `AppServerNotificationRouter` for protocol event routing
  - `AppServerStreamEmitter` for AI SDK stream part emission
  - `AppServerSession` for session-scoped actions
- **Mid-execution session controls**:
  - `onSessionCreated` callback on app-server settings/provider options
  - `session.injectMessage(...)` and `session.interrupt()` support
- **Thread ergonomics for app-server mode**:
  - `threadMode` (`stateless` default, `persistent` opt-in)
  - `resume` shorthand for continuing an existing thread
- **Instruction settings for app-server threads**:
  - `baseInstructions`
  - `developerInstructions`
- **Model discovery API**:
  - New standalone `listModels()` helper (spawns temporary app-server client and disposes it safely)
  - Provider method `provider.listModels(...)`
- **Explicit provider lifecycle aliases**:
  - `provider.close()`
  - `provider.dispose()`
- **Local MCP/tooling helpers**:
  - `tool(...)`
  - `createLocalMcpServer(...)`
  - `createSdkMcpServer(...)`
- **Stream UX parity improvements for app-server mode**:
  - reasoning delta support (modern + legacy notification methods)
  - text/reasoning lifecycle parts (`text-start/end`, `reasoning-start/end`)
  - approval request stream parts (`tool-approval-request`)
  - tool output delta mapping (`item/commandExecution/outputDelta`, `item/fileChange/outputDelta`)
  - optional raw chunk emission via `includeRawChunks`
- **Remote image URL support in app-server mode**:
  - model advertises `supportsImageUrls = true`
  - HTTP/HTTPS image URLs are passed directly as app-server image inputs
- **Tool execution statistics in finish metadata**:
  - `providerMetadata['codex-app-server'].toolExecutionStats`
  - includes total calls, by-type counts, and duration aggregation
- **App-server compatibility fixtures/tests expanded**:
  - reasoning delta fixtures
  - output delta fixtures
  - additional router behavior/unit coverage
- **Migration guide added**:
  - `docs/ai-sdk-v5/migration-app-server-v2.md`
- **Validation tooling for docs/examples**:
  - `validate:docs` checks markdown links and example command paths
  - `validate:examples:app-server` executes app-server examples and validates output expectations
  - example validation fails on unexpected repository changes/artifacts produced during runs
- **App-server settings surface (canonical)**:
  - `approvalPolicy` / `sandboxPolicy`
  - `effort` / `summary`
  - `serverRequests` (typed handler map)
- **Strict app-server provider/options validation**:
  - legacy app-server alias keys are rejected by app-server validation
- **App-server default behavior**:
  - `threadMode` remains `stateless` by default
  - explicit `threadId` still takes precedence over automatic persistent reuse
- **Standalone model-list helper naming**:
  - canonical helper is `listModels()`
- **Case-tolerant protocol item handling**:
  - item type routing normalizes casing for safer cross-version compatibility
- **Examples reorganized and expanded**:
  - split into `examples/exec/` and `examples/app-server/`
  - removed redundant `*-gpt-5-codex.mjs` duplicate scripts (canonical examples now cover each flow once)
  - app-server examples updated to canonical field names
  - app-server-only examples added (`list-models`, `session-injection`, `local-mcp-tool`, `abort`, `raw-chunks`, `usage-metadata`)
- **Security: `file://` image URL rejection**: `file://` URLs passed as image inputs are rejected to prevent arbitrary file reads. Local-image path input via the dedicated flow is unaffected. Applies to both exec and app-server providers.
- **Security: strict base64 validation for image inputs**: Raw base64 strings are validated (charset, length, round-trip decode) before constructing `data:` URLs, preventing silently malformed image payloads.
- **Security: MCP server name validation**: MCP server names must match `^[A-Za-z0-9_-]+$`. Names containing dots, equals signs, whitespace, or other special characters are rejected at both schema validation and runtime. Applies to both exec and app-server providers.
- **Security: config override key validation**: Config override keys must match `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$`. Keys containing equals signs, empty path segments, newlines, or other special characters are rejected. Applies to both exec and app-server providers.
- **App-server notification schema enforcement**: Notifications that fail schema validation for known methods are dropped with a warning instead of being forwarded to downstream handlers.
- **App-server thread-scoped notification routing**: Notifications without an explicit `threadId` are not routed to per-thread routers, preventing duplicate event processing in multi-thread scenarios.
- **App-server `codexErrorInfo` typed validation**: `codexErrorInfo` fields are validated with a full typed Zod union schema (string literals + object variants).
- **App-server JSON-mode emitter bounded buffering**: The stream emitter in `jsonModeLastTextBlockOnly` mode uses O(1) bounded buffering (current + last-completed block) instead of accumulating all text blocks.

### Fixed

- **JSON-RPC response/error parsing ambiguity**: prevent error responses from being interpreted as successful result responses.
- **App-server feature gating diagnostics**:
  - `UnsupportedFeatureError` added for explicit unsupported capability paths (e.g., `model/list` not supported).
- **Stream/generate parity**:
  - `doGenerate` now aggregates from the same routed stream/event path as `doStream`, reducing divergence and duplicated event handling logic.
- **`doGenerate` content completeness (app-server)**:
  - generation results now retain streamed reasoning/tool parts (`reasoning`, `tool-call`, `tool-result`, plus text) instead of returning text-only content.
- **`doGenerate` content completeness (exec/legacy provider)**:
  - generation results now retain streamed tool parts (`tool-call`, `tool-result`, plus text) instead of returning text-only content.
- **Unknown-usage semantics aligned to AI SDK v3**:
  - default usage fields now use `undefined` when token counts are unknown (instead of `0`), avoiding false precision in telemetry.
- **Unsupported-setting warnings coverage**:
  - added explicit unsupported warning for `maxOutputTokens` (ignored by Codex providers).
- **Authentication error detection**: `isAuthenticationError` now checks `data.code` for `'401'`/`'unauthorized'`/`'auth'` instead of the unreachable `exitCode === 401` comparison.
- **App-server crash handler child cleanup**: `handleCrash` now sends `SIGTERM` to the child process before clearing the reference, preventing orphaned processes.
- **App-server idle-timeout state cleanup**: Idle-timeout shutdown now clears all bookkeeping (thread locks, request contexts, completed turn IDs) so restart state is clean.
- **App-server cancel-before-turn-id race**: Cancelling a stream after `turn/start` is requested but before `turnId` is assigned now closes the stream immediately and issues a late interrupt when the turn ID arrives, instead of leaving the stream open indefinitely.

### Migration Notes (App-Server Users)

If you use `createCodexAppServer`, migrate to canonical keys:

- `approvalMode` -> `approvalPolicy`
- `sandboxMode` -> `sandboxPolicy`
- `reasoningEffort` -> `effort`
- `reasoningSummary` -> `summary`

`codexExec` / `codexCli` compatibility exports remain available for existing exec-mode users.

### Migration Notes (All Users from 1.0.x)

The following hardening changes apply to both exec and app-server providers:

- `file://` image URL strings are no longer accepted. Use `data:` URLs, raw base64 strings, or binary inputs instead.
- MCP server names must match `^[A-Za-z0-9_-]+$`. Rename any servers using dots, spaces, or special characters.
- Config override keys must match `^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$`. Keys with empty segments or special characters must be corrected.

## [1.0.5] - 2026-01-17

### Fixed

- **Windows command line limit and special character escaping**: Fix bug where long prompts or prompts containing special characters (Chinese text, newlines, backticks, template literals) would fail on Windows due to command line length limits (~8191 chars) and shell escaping issues. Prompts are now passed via stdin instead of command line arguments. (#22)

### Changed

- Update `@openai/codex` optional dependency from `^0.77.0` to `^0.87.0`

## [1.0.4] - 2026-01-01

### Fixed

- **Image + prompt argument parsing**: Fix bug where using images with `streamText` caused "No prompt provided via stdin" error. Codex CLI's `--image` flag uses greedy argument parsing (`num_args = 1..`), which consumed the prompt text as an additional image path. Now adds `'--'` separator before the prompt when images are present to explicitly mark end of flags. (#19)

## [1.0.3] - 2025-12-29

### Fixed

- **codexPath executable support**: Fix bug where providing an explicit `codexPath` to a native executable (e.g., Homebrew's `/opt/homebrew/bin/codex`) was incorrectly executed via `node`, causing `SyntaxError: Invalid or unexpected token`. Now correctly distinguishes between JS entrypoints (`.js`, `.mjs`, `.cjs`) and native executables. (#15)

## [1.0.2] - 2025-12-28

### Added

- **GPT-5.2 model support**: Add `gpt-5.2`, `gpt-5.2-codex`, and related model slugs to documentation
- **`'none'` reasoning effort**: Add `'none'` to `ReasoningEffort` type - the default for GPT-5.1+ models (no extra reasoning). `'minimal'` retained as backwards-compatible alias for older GPT-5 slugs.

## [1.0.1] - 2025-12-28

### Changed

- Update `@openai/codex` optional dependency from `^0.60.1` to `^0.77.0`

### Removed

- **BREAKING:** Remove `includePlanTool` setting - The `--include-plan-tool` CLI flag was removed in Codex CLI 0.48.0 (Oct 2025). The plan tool is now always enabled by default; no configuration needed.

### Fixed

- Fix `streaming-multiple-tools.mjs` example where `part.input` could be an object instead of a string, causing `substring is not a function` error

## [1.0.0] - 2025-12-27

### Breaking Changes

- **AI SDK v6 stable migration** - This release requires AI SDK v6 stable and is incompatible with AI SDK v5
- **Provider interface**: `LanguageModelV2` → `LanguageModelV3`, `ProviderV2` → `ProviderV3`
- **Specification version**: `specificationVersion` changed from `'v2'` to `'v3'`
- **Warning format**: Changed from `{ type: 'unsupported-setting', setting: ... }` to `{ type: 'unsupported', feature: ... }`
- **Finish reason format**: Changed from string to object:

  ```typescript
  // Old (v5)
  finishReason: 'stop'

  // New (v6)
  finishReason: { unified: 'stop', raw: undefined }
  ```

- **Usage structure**: Changed from flat to hierarchical format with `raw` field:

  ```typescript
  // Old (v5)
  { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 1 }

  // New (v6)
  {
    inputTokens: { total: 10, noCache: 9, cacheRead: 1, cacheWrite: 0 },
    outputTokens: { total: 5, text: undefined, reasoning: undefined },
    raw: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 1 }
  }
  ```

- **Method rename**: `textEmbeddingModel()` → `embeddingModel()` (throws `NoSuchModelError`)

### Changed

- Dependencies updated to stable versions:
  - `@ai-sdk/provider`: ^3.0.0
  - `@ai-sdk/provider-utils`: ^4.0.1
  - `ai` (dev): ^6.0.3
- Examples updated for v6 stable patterns (nested usage access, finish reason object)

### Migration from AI SDK v5

For AI SDK v5 users:

```bash
npm install ai-sdk-provider-codex-cli@ai-sdk-v5 ai@^5.0.0
```

### Version Compatibility

| Provider Version | AI SDK Version | NPM Installation                                      |
| ---------------- | -------------- | ----------------------------------------------------- |
| 1.x.x            | v6             | `npm i ai-sdk-provider-codex-cli ai@^6.0.0`           |
| 0.x.x            | v5             | `npm i ai-sdk-provider-codex-cli@ai-sdk-v5 ai@^5.0.0` |

## [1.0.0-beta.1] - 2025-12-15

### Notes

- Beta release for AI SDK v6 beta - superseded by 1.0.0 stable

## [0.7.0] - 2025-12-15

### Added

- **Multimodal image support** via `--image` flag (#10)
  - Supports base64 data URLs, raw base64 strings, Buffer, ArrayBuffer, and Uint8Array
  - Images extracted from AI SDK message parts and passed to Codex CLI as temp files
  - Automatic cleanup of temp image files after request completion

## [0.6.0] - 2025-11-21

### Added

- **First-class MCP configuration**: `mcpServers` and `rmcpClient` settings map directly to Codex CLI MCP config keys (stdio + HTTP/RMCP), with per-call overrides, validation, and tests.
- **Documentation and examples**: README, docs, and examples now show MCP server setup without relying on `configOverrides`.
- **Add-dirs support**: New `addDirs` setting (array of strings) to expose additional directories to the model context (maps to `--add-dir`).

### Fixed

- **File Preservation**: The `outputLastMessageFile` is no longer deleted after execution if the user explicitly provided the path. Auto-generated temp files are still cleaned up.

## [0.5.0] - 2025-10-21

### Added

- **Comprehensive logging system** with configurable verbosity and custom logger support
  - Added `debug` and `info` log levels to complement existing `warn` and `error` levels
  - New `verbose` setting to control debug/info logging visibility (default: `false` for clean production output)
  - New `logger` setting for custom logger support or `false` to disable all logging
  - `Logger` interface: Standardized four-level logging (debug, info, warn, error)
  - Default logger with level tags: `[DEBUG]`, `[INFO]`, `[WARN]`, `[ERROR]` prefixes
  - Detailed execution tracing including request/response flow, stream events, and process lifecycle
  - When `verbose: false` (default), only `warn` and `error` messages are logged
  - When `verbose: true`, all log levels including `debug` and `info` are logged
  - `createVerboseLogger()` utility that filters debug/info logs based on verbose mode
  - `this` context preservation via `.bind()` for class-based custom loggers
- **Logging examples:**
  - `examples/logging-default.mjs`: Default non-verbose mode (warn/error only)
  - `examples/logging-verbose.mjs`: Verbose mode with full debug visibility
  - `examples/logging-custom-logger.mjs`: Custom logger integration (Winston, Pino, etc.)
  - `examples/logging-disabled.mjs`: Complete logging suppression
- **Documentation:**
  - `docs/ai-sdk-v5/guide.md`: Comprehensive logging configuration section
  - `docs/ai-sdk-v5/configuration.md`: Detailed `verbose` and `logger` parameter documentation
  - `examples/README.md`: Logging examples section with usage patterns

### Potentially Breaking Changes

**Who is affected:** Only users with custom `Logger` implementations (estimated <5% of users).

**What changed:** The `Logger` interface now requires 4 methods instead of 2:

- `debug(message: string): void` - NEW - for detailed execution tracing (verbose mode only)
- `info(message: string): void` - NEW - for general flow information (verbose mode only)
- `warn(message: string): void` - existing
- `error(message: string): void` - existing

**Migration for custom logger users:**

```typescript
// Before (v0.4.x) ❌
const logger = {
  warn: (msg) => myLogger.warn(msg),
  error: (msg) => myLogger.error(msg),
};

// After (v0.5.0+) ✅
const logger = {
  debug: (msg) => myLogger.debug(msg), // Add this
  info: (msg) => myLogger.info(msg), // Add this
  warn: (msg) => myLogger.warn(msg),
  error: (msg) => myLogger.error(msg),
};
```

**Most users are unaffected:**

- Users without a custom logger (using default `console`) - no changes needed
- Users with `logger: false` - no changes needed
- The default logger automatically handles all log levels

### Changed

- **Default logger now includes level tags** - All log messages are prefixed with `[DEBUG]`, `[INFO]`, `[WARN]`, or `[ERROR]` for clarity
  - May affect applications parsing console output (use custom logger or `logger: false` if needed)
- Non-verbose mode (default) only shows warn/error messages for cleaner production logs

### Technical Details

- All new settings (`verbose`, `logger`) are optional with safe defaults
- 7 new unit tests covering logger functionality (all passing)
- Comprehensive test coverage for all logging scenarios and custom logger implementations
- Supports custom logging integrations (Winston, Pino, Datadog, Sentry, etc.)

## [0.4.0] - 2025-10-06

### Added

- **Constructor-level model parameters:**
  - `reasoningEffort`: Control reasoning depth for o3, o4-mini, gpt-5, gpt-5-codex ('minimal' | 'low' | 'medium' | 'high')
  - `reasoningSummary`: Control reasoning summary detail level ('auto' | 'detailed')
    - Note: Only 'auto' and 'detailed' are supported despite API error messages claiming otherwise
  - `reasoningSummaryFormat`: Experimental format control ('none' | 'experimental')
  - `modelVerbosity`: GPT-5 family output length control ('low' | 'medium' | 'high')
- **Advanced Codex features:**
  - `profile`: Load config profile from `~/.codex/config.toml` (`--profile <name>`)
  - `oss`: Use OSS provider (`--oss`)
  - `webSearch`: Enable web search tool (`-c tools.web_search=true`)
- **Generic config overrides:**
  - `configOverrides`: Ultimate flexibility - set ANY Codex CLI config value via `-c key=value`
  - Plain objects flattened recursively to dotted keys (e.g., `{sandbox_workspace_write: {network_access: true}}` → `-c sandbox_workspace_write.network_access=true`)
  - Arrays serialized to JSON strings
  - Enables future Codex features without provider updates
- **Per-call parameter overrides:**
  - `providerOptions['codex-cli']` support with `CodexCliProviderOptions` interface
  - Override `reasoningEffort`, `reasoningSummary`, `reasoningSummaryFormat` per request
  - `textVerbosity` (AI SDK naming convention) maps to internal `modelVerbosity`
  - Per-call `configOverrides` merge with constructor settings (per-call values take precedence)
  - Settings precedence: `providerOptions` > constructor settings > Codex CLI defaults
- **Type exports:**
  - `ReasoningEffort`, `ReasoningSummary`, `ReasoningSummaryFormat`, `ModelVerbosity`
  - `CodexCliProviderOptions` for per-call override typing
- **Documentation:**
  - README section: "Model Parameters & Advanced Options (v0.4.0+)"
  - README section: "Per-call overrides via providerOptions (v0.4.0+)"
  - `docs/ai-sdk-v5/configuration.md`: Comprehensive parameter descriptions with CLI flag mappings
  - `docs/ai-sdk-v5/limitations.md`: Model parameter validation quirks documented
- **Examples:**
  - `examples/advanced-settings.mjs`: Demonstrates constructor-level parameters and advanced features
  - `examples/provider-options.mjs`: Demonstrates per-call override patterns

### Changed

- Extended `CodexCliSettings` interface with 8 new optional properties
- `buildArgs()` method updated to accept merged settings parameter
- `doGenerate()` and `doStream()` now parse provider options and merge with constructor settings
- Validation schema extended to validate new parameters and reject invalid `reasoningSummary` values

### Fixed

- Incorrect `reasoningSummary` type that included invalid 'concise' and 'none' values
- Misleading documentation suggesting 'concise' and 'none' work (they don't)
- False limitation warning about reasoning + webSearch combination (was caused by invalid parameter values)

### Technical Details

- Zero breaking changes - all new parameters are optional
- Full backward compatibility with v0.3.0
- 28 tests passing (17 language model tests including 4 new provider options tests)
- Follows AI SDK v5 standard pattern for provider options (consistent with @ai-sdk/openai)
- Zod schema validation with `.strict()` mode to catch invalid properties

## [0.3.0] - 2025-10-03

### Added

- **Comprehensive tool streaming support** - Real-time monitoring of Codex CLI's autonomous tool execution
  - Tool invocation events (`tool-input-start`, `tool-input-delta`, `tool-input-end`)
  - Tool call events with `providerExecuted: true` (Codex executes tools autonomously)
  - Tool result events with complete output payloads
  - Support for all Codex tool types: `exec`, `patch`, `web_search`, `mcp_tool_call`
- Turn-level usage tracking via `turn.completed` events (requires Codex CLI >= 0.44.0)
- New examples:
  - `streaming-tool-calls.mjs` - Basic tool streaming demonstration
  - `streaming-multiple-tools.mjs` - Complex multi-tool workflows with result tracking
- Comprehensive tool streaming documentation in `examples/README.md`

### Fixed

- **Empty schema handling** - No longer adds `additionalProperties: false` to empty schemas (e.g., from `z.any()`)
- **Text event sequence** - Proper emission of `text-start` before `text-delta` events
- **Stream timing race condition** - Use `setImmediate` to ensure all buffered stdout events process before stream finishes

### Changed

- Updated `@openai/codex` optional dependency from `*` to `^0.44.0` for usage tracking support
- Test fixtures updated to match actual Codex CLI event format (`thread.started` vs `session.created`)

### Limitations

- **No real-time output streaming yet** - Tool outputs delivered in final `tool-result` event via `aggregatedOutput` field, not as incremental deltas. Requires Codex CLI to add output-delta events to experimental JSON format.

## [0.2.0] - 2025-09-30

### Breaking Changes

- **Switched to `--experimental-json` exclusively** (removed deprecated `--json` flag)
- **Native `--output-schema` support for all JSON generation** (removed prompt engineering)
  - When using `generateObject`, the provider now writes the JSON schema to a temp file and passes it via `--output-schema` flag
  - The Codex CLI sends the schema to OpenAI's Responses API with `strict: true`, enforcing JSON at the model level
  - No more manual JSON instructions injected into prompts
- **Removed `extract-json.ts` module** - JSON output is now API-guaranteed to be valid
- **Simplified `mapMessagesToPrompt`** - removed `mode` and `jsonSchema` parameters
- **New event format from experimental JSON output** - event structure changed from old `--json` format

### Added

- Native JSON Schema enforcement via Codex CLI `--output-schema` flag
- Better usage tracking from `turn.completed` events (experimental JSON format)
- Support for `session.created`, `turn.completed`, and `item.completed` event types
- Automatic cleanup of temp schema files after request completion
- New example: `generate-object-native-schema.mjs` demonstrating native schema capabilities
- New example: `experimental-json-events.mjs` showcasing new event format
- New example: `migration-guide-example.mjs` with before/after comparison
- Migration guide: `docs/ai-sdk-v5/migration-0.2.md`

### Improved

- **Token efficiency**: Eliminates 100-200 tokens per JSON request (no prompt engineering overhead)
- **Reliability**: API-level schema enforcement with strict mode > prompt engineering
- **Simpler codebase**: Removed brittle JSON extraction logic and legacy code paths
- **Better event parsing**: Structured experimental JSON format with proper usage tracking

### Removed

- Prompt engineering for JSON mode (previously injected verbose JSON instructions)
- Legacy `--json` flag support (replaced by `--experimental-json`)
- `extract-json.ts` module (no longer needed with native schema)
- `PromptMode` type from `message-mapper.ts`
- Backward compatibility with old event format

## [0.1.0] - 2025-08-19

### Added

- Initial release with AI SDK v5 support
- Support for `generateText`, `streamText`, and `generateObject`
- ChatGPT OAuth authentication via `codex login`
- Configurable approval and sandbox modes
- Examples for basic usage, streaming, and object generation

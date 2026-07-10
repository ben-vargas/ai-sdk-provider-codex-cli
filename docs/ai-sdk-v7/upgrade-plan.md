# AI SDK v7 Compatibility Upgrade Plan

Date: 2026-07-06

> Historical implementation plan. This document records the pre-migration state and decisions used to build the v7 branch; use the other `docs/ai-sdk-v7/*` guides for current user-facing guidance.

This plan covers the `ai-sdk-provider-codex-cli` upgrade from the current AI SDK v6 line to an AI SDK v7-compatible release. It also records the branch/release strategy and agent-capability opportunities from AI SDK v7 and the Claude Agent SDK that are worth considering without overcommitting Codex-specific APIs that the Codex app-server protocol does not expose yet.

## Current repo and release state

- Active branch: `main` at `84f0e05780dd10c72403e27091678f011f0b5185`, tagged `v1.2.2`; working tree was clean during scouting.
- Current package: `ai-sdk-provider-codex-cli@1.2.2`, described as an AI SDK v6 provider.
- Current SDK dependency family:
  - `@ai-sdk/provider`: `^3.0.0` (`3.0.10` in lockfile)
  - `@ai-sdk/provider-utils`: `^4.0.1` (`4.0.27` in lockfile)
  - `ai`: `^6.0.3` (`6.0.182` in lockfile)
  - `@openai/codex`: optional `^0.130.0`
  - `engines.node`: `>=18`
- Existing compatibility lines:
  - `main` / npm `latest`: AI SDK v6, package `1.x`, current `1.2.2`
  - `origin/ai-sdk-v5` / npm `ai-sdk-v5`: AI SDK v5, package `0.7.3`
  - `origin/ai-sdk-v4` / npm `ai-sdk-v4`: AI SDK v4, package `0.1.0-ai-sdk-v4`
- Current docs structure is stale for the active branch: README is v6-oriented, but active docs still live under `docs/ai-sdk-v5/` and README links to those v5 docs.
- Codex CLI drift:
  - Repository optional dependency is still `@openai/codex@^0.130.0`.
  - Global Codex available in the scout session was `0.142.5`.
  - Live `app-server model/list` through the current provider returned default `gpt-5.5` and models `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, and `gpt-5.3-codex-spark`.
  - The local optional `@openai/codex@0.130.0` install looked unhealthy for direct binary execution on this workstation, so v7 work should validate against an explicit Codex path or refreshed optional dependency rather than assuming the installed optional binary works.

## Executive decisions

1. **Release AI SDK v7 compatibility as `2.0.0`.** The AI SDK major/provider-interface change is a breaking contract, matching the prior v5-to-v6 `1.0.0` cutover.
2. **Keep `main` as the active SDK-major line.** Cut an `ai-sdk-v6` maintenance branch from current `main`/`v1.2.2` before v7 lands.
3. **Make v7 native, not merely v3-proxied.** AI SDK v7 can still accept `LanguageModelV3`, but its v3-to-v4 adapter only overrides `specificationVersion`; it does not down-convert v4 prompt/file shapes. Target native `LanguageModelV4` / `ProviderV4` for the stable v7 release.
4. **Ship `2.0.0` ESM-only (decided).** AI SDK v7 packages are ESM-only and require Node 22+; `@ai-sdk/provider-utils@5` is an ESM-only _runtime_ dependency. A retained CJS entry would rely on `require(esm)` — unflagged only from Node 22.12+ while `engines >=22` admits 22.0–22.11 — and would break if the dependency graph ever gains top-level await. Remove the `require` export and CJS build; document ESM-only support.
5. **Do not hard-code a broad model catalog.** Use one current example model (`gpt-5.5` if still returned by `listModels()` during release verification) and document that model availability follows the installed Codex CLI. Keep `listModels()` / `provider.listModels()` prominent.
6. **Treat Claude Agent SDK features as design references, not a direct API surface.** Add only features backed by Codex app-server protocol or AI SDK v7 public APIs. Defer Claude-specific fork/session-store/hooks/background-task/file-rewind APIs unless Codex exposes equivalent capabilities.

## Branch, version, and publishing strategy

### Branches

- Before v7 implementation:
  - Create `ai-sdk-v6` from `84f0e05` / `v1.2.2`.
  - Push `ai-sdk-v6` to origin.
  - Leave `origin/ai-sdk-v5` and `origin/ai-sdk-v4` unchanged.
- During v7 implementation:
  - Use a short-lived `ai-sdk-v7` feature branch if the work is not immediately releasable.
  - Merge v7 to `main` for the stable `2.0.0` release.
- After v7 stable:
  - `main`: active v7 line.
  - `ai-sdk-v6`: maintenance branch for v6 users.
  - `ai-sdk-v5`: critical fixes only.
  - `ai-sdk-v4`: frozen except severe install/security breakage.

### npm dist-tags

Before publishing stable v7:

```bash
npm dist-tag add ai-sdk-provider-codex-cli@1.2.2 ai-sdk-v6
```

For prereleases:

```bash
npm publish --tag next
npm dist-tag add ai-sdk-provider-codex-cli@2.0.0-beta.N ai-sdk-v7
```

For stable:

```bash
npm publish --tag latest
npm dist-tag add ai-sdk-provider-codex-cli@2.0.0 ai-sdk-v7
```

Preserve:

- `ai-sdk-v5 -> 0.7.3`
- `ai-sdk-v4 -> 0.1.0-ai-sdk-v4`

After v7 is stable, every maintenance publish from an older SDK-major branch must publish with its SDK-major tag, not the npm default `latest` tag:

```bash
npm publish --tag ai-sdk-v6  # from the 1.x / ai-sdk-v6 branch
npm publish --tag ai-sdk-v5  # from the 0.7.x / ai-sdk-v5 branch
```

This prevents a routine v6/v5 patch release from accidentally moving `latest` away from the v7 line.

### Tags and release hygiene

- Tag the stable release as `v2.0.0` on the exact package-version commit.
- Tag prereleases as `v2.0.0-beta.N` only when `package.json` also has `2.0.0-beta.N`.
- Avoid repeating existing tag/package mismatches observed during scouting:
  - npm has `1.2.0`, but Git has no `v1.2.0` tag.
  - npm has `0.1.0-ai-sdk-v4`, but Git has no matching `*ai-sdk-v4*` tag.
  - Git tag `v1.0.0-beta.1` points at a commit whose package version was `0.7.0`.

## Target dependency and runtime changes

Update package metadata for v7:

- `version`: `2.0.0` for stable release.
- `description`: AI SDK v7 provider.
- `engines.node`: `>=22`.
- Runtime dependencies:
  - `@ai-sdk/provider`: `^4.0.0`
  - `@ai-sdk/provider-utils`: `^5.0.0`
- Peer dependencies:
  - raise `zod` from `^3.0.0 || ^4.0.0` to `^3.25.76 || ^4.1.8` to match the AI SDK v7 / `@ai-sdk/provider-utils@5` peer range.
- Dev dependencies:
  - `ai`: `^7.0.0`
  - align `@types/node` with Node 22
  - align TypeScript with the local AI SDK v7 workspace baseline if type friction appears.
- Optional dependency:
  - refresh `@openai/codex` from `^0.130.0` to a validated current line after release testing, likely `^0.142.5` if that remains current and app-server protocol tests pass.
- Package format (decided: ESM-only):
  - `tsup.config.ts`: `format: ['esm', 'cjs']` -> `['esm']`; remove the `require` condition from `exports`.
  - Remove the top-level `main` field (currently `./dist/index.cjs`) and the legacy `module` field; `exports` with `types` + `import` is the only entrypoint.
  - Rationale: `require(esm)` is unflagged only from Node 22.12+, and a CJS entry silently breaks if the transitive graph gains top-level await. Not a supportable contract for a major release.

## Provider-interface migration plan

### P0: native v4 provider cutover

Update all exported and internal provider types from v3 to v4:

- `LanguageModelV3` -> `LanguageModelV4`
- `ProviderV3` -> `ProviderV4`
- `SharedV3ProviderMetadata` / `SharedV3Warning` / `SharedV3ProviderOptions` -> v4 equivalents
- `LanguageModelV3*` stream/content/tool/usage/finish types -> v4 equivalents
- `specificationVersion: 'v3'` -> `specificationVersion: 'v4'`

Primary files:

- `src/exec-language-model.ts`
- `src/exec-provider.ts`
- `src/app-server/language-model.ts`
- `src/app-server/provider.ts`
- `src/app-server/stream/emitter.ts`
- `src/app-server/stream/router.ts`
- `src/app-server/stream/turn-stream-controller.ts`
- `src/converters/types.ts`
- `src/converters/prompt-converter.ts`
- tests under `src/__tests__/`

Keep provider-specific extension properties only if they still serve AI SDK v7 behavior:

- `supportedUrls` remains required.
- `defaultObjectGenerationMode`, `supportsStructuredOutputs`, and `supportsImageUrls` are legacy v1/v2-era extras absent from `LanguageModelV4`; remove them in `2.0.0`.

### P0: v7 prompt, file, tool-result, and custom-part compatibility

AI SDK v7 canonicalizes file/image inputs and tool-result content differently than the current converters expect.

Implement converter support for v4 message file shapes:

- `part.type === 'file'`
- `part.data.type === 'data'` with `Uint8Array` or base64 string
- `part.data.type === 'url'`
- `part.data.type === 'reference'`
- `part.data.type === 'text'`
- top-level media type segments such as `mediaType: 'image'`, not only `image/*`

Implement tool-result converter support for v7 canonical file content:

- `output.type === 'content'` entries with `type: 'file'`
- `data.type === 'data'`
- `data.type === 'url'`
- `data.type === 'reference'`
- media/image markers should retain the fidelity currently provided by legacy v6 `file-data`, `file-url`, `file-id`, `image-data`, `image-url`, and `image-file-id` branches.

Add explicit handling for v4 `custom` parts:

- assistant prompt `type: 'custom'`
- tool-result content `type: 'custom'`
- generated/streamed `LanguageModelV4CustomContent`
- policy: warn/skip unless the part is a Codex-owned stable custom kind that this provider intentionally supports.

Provider behavior:

- Exec provider:
  - local/binary image data should still become temp files for `codex exec --image`.
  - remote URLs remain unsupported unless Codex exec adds native remote-image support; emit explicit warnings.
  - non-image files should produce warnings unless a real Codex input path exists.
- App-server provider:
  - decided for `2.0.0`: keep `supportedUrls = {}`. AI SDK v7 downloads remote URLs and delivers inline data, which flows through the existing tested temp-file/local-image path; no new Codex protocol dependency.
  - URL passthrough (non-empty `supportedUrls`) is deferred until the Codex app-server verifiably accepts remote image URLs natively.
  - binary images should continue through temp files as `{ type: 'localImage', path }`.
  - non-image files should be warned or mapped only if Codex app-server adds file input support.

Add explicit handling for v4 `reasoning-file` prompt/content parts:

- If Codex cannot consume them, emit an unsupported warning instead of silently dropping them.
- Add future output support only if Codex starts producing reasoning artifacts.

### P0: top-level v7 reasoning option

AI SDK v7 adds provider-agnostic call option:

```ts
reasoning?: 'provider-default' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
```

Current provider behavior only honors provider-specific options:

- exec: `providerOptions['codex-cli'].reasoningEffort`
- app-server: `providerOptions['codex-app-server'].effort`

Plan:

- Map top-level `options.reasoning` to Codex effort when provider-specific reasoning/effort is absent.
- Preserve provider-specific options as the higher-precedence override.
- Document precedence.
- Add tests for top-level reasoning, provider-specific override, and `provider-default` behavior.

### P1: streams, tool calls, and approvals

The existing emitted stream part names remain valid in AI SDK v7 v4:

- `stream-start`
- `response-metadata`
- `text-start` / `text-delta` / `text-end`
- `reasoning-start` / `reasoning-delta` / `reasoning-end`
- `tool-input-start` / `tool-input-delta` / `tool-input-end`
- `tool-call`
- `tool-result`
- `tool-approval-request`
- `raw`
- `finish`
- `error`

Required work:

- Preserve `providerExecuted: true` for Codex-executed tools.
- Preserve `dynamic: true` for runtime/provider tools such as Codex MCP tools.
- Keep app-server approval requests typed and tested.
- Add docs explaining the distinction between:
  - AI SDK v7 SDK-tool approvals via `toolApproval`
  - Codex-native command/file/skill/MCP approvals via provider `serverRequests` and app-server stream parts.

Avoid overclaiming: Codex-native approvals are not automatically the same as SDK client-tool approvals.

### P1: structured outputs

Keep current JSON response-format path:

- AI SDK v7 `generateObject` and `streamObject` still pass `responseFormat: { type: 'json', schema, name, description }` to the provider.
- Exec provider should continue writing `--output-schema` after schema sanitization.
- App-server provider should continue passing `outputSchema` and using JSON last-text-block behavior.

Tests to add/update:

- `generateObject` with required strict schema.
- `streamObject` with incremental JSON output.
- Optional-field limitation remains documented because OpenAI strict JSON schema still requires required fields.

### P1: result and example migration

Update user-facing docs/examples for AI SDK v7 API changes:

- `result.fullStream` -> `result.stream`.
- Prefer `instructions` over `system` in public examples.
- `includeRawChunks` user-facing option -> `include: { rawChunks: true }`; keep provider-specific `providerOptions['codex-app-server'].includeRawChunks` only as a provider opt-in.
- Prefer `result.finalStep.providerMetadata`, `result.finalStep.request`, and `result.finalStep.response` where examples need final-step data.
- Update usage examples away from old aliases such as `cachedInputTokens` toward v7 usage detail fields.
- Note in `migration-v6-to-v7.md`: AI SDK 7 rejects `{ role: 'system' }` messages inside `prompt`/`messages` by default; system text belongs in the top-level `instructions` option. This affects users with persisted v6 chats, independent of this provider.

## Codex app-server and model plan

### Codex version strategy

- Refresh optional `@openai/codex` only after protocol tests pass against the target version.
- Use `scripts/sync-protocol-types.sh` against the target Codex CLI to regenerate the app-server protocol reference.
- Copy only needed protocol subsets into `src/app-server/protocol/types.ts` and update validators/tests.
- Gate new app-server features with `minCodexVersion` and feature detection rather than assuming a newer CLI.

### Model docs strategy

- Use a single current default model in examples, likely `gpt-5.5` if release-time `listModels()` still returns it.
- Mention the scout-observed model list only as an example of drift, not as a promised catalog.
- Document:
  - `listModels()` standalone helper.
  - `provider.listModels()` on app-server provider.
  - model slugs are owned by Codex/OpenAI and can change independently of this package.
  - update concrete stale-model surfaces: `README.md` headline/catalog text and `package.json` keywords.

## v7 and Claude Agent SDK capability opportunities

### High-value for this package

1. **AI SDK v7 ToolLoopAgent / WorkflowAgent examples**
   - Add examples using `codexAppServer` as the backing model.
   - Show `providerOptions['codex-app-server']` in agent flows.
   - Show `prepareStep` adjusting provider options per step.
   - Keep examples small and provider-centered.

2. **Persistent Codex app-server sessions as the main agent feature**
   - Promote `threadMode`, `threadId`, `resume`, `persistExtendedHistory`, and `onSessionCreated` in v7 docs.
   - Document `injectMessage()` and `interrupt()` as live-control capabilities already supported by the provider.
   - Avoid promising Claude-like fork/resume-at-message/session-store unless Codex exposes those protocol operations.

3. **MCP lifecycle alignment**
   - Align docs/types with AI SDK MCP v2 concepts: stdio, HTTP, SSE, SDK/in-process MCP servers, provider-owned vs request-scoped lifecycle.
   - Keep existing lifecycle manager semantics: provider-owned servers persist; request-scoped servers are released on failure/finish.
   - Consider dynamic MCP update/status APIs only if Codex app-server exposes reconnect/toggle/set/status protocol methods.

4. **Approval and elicitation clarity**
   - Keep `serverRequests` as the escape hatch for Codex-native command/file/skill/MCP elicitations.
   - Document persist/remember semantics only when the Codex protocol semantics are exact and tested.
   - Add tests for `mcpServer/elicitation/request` and dynamic tool approval handling because this is a core app-server value proposition.

5. **Raw chunks as advanced opt-in**
   - Keep raw JSON-RPC chunks opt-in.
   - Do not map raw Codex app-server notifications into a fake stable standard event model.
   - Test that raw chunks do not break AI SDK v7 workflow/UI stream transforms.

### Medium-value, gated by protocol support

- `setModel()` / mid-session model switching.
- `mcpServerStatus()`, `reconnectMcpServer()`, `toggleMcpServer()`, `setMcpServers()`.
- A Codex-backed sandbox adapter for AI SDK v7 `SandboxSession` if a real filesystem/process adapter exists.
- Provider-tool definitions if Codex-native tools become representable through `LanguageModelV4ProviderTool`.

### Defer for v7 core

These Claude Agent SDK capabilities are useful references but should not be copied into this package without Codex protocol support:

- session store / transcript portability
- fork session / resume at message
- general hook DSL
- background tasks and subagent management
- file checkpoint / rewind
- broad Claude-style live control surface
- full harness integration

If pursued, harness integration should likely be a separate package or separate roadmap item, not part of the v7 provider compatibility release.

## Documentation plan

Add `docs/ai-sdk-v7/` with:

- `guide.md`
- `configuration.md`
- `limitations.md`
- `troubleshooting.md`
- `migration-v6-to-v7.md`
- this `upgrade-plan.md`

Update README:

- Badge/headline: AI SDK v7.
- Compatibility table:

| Package line      | AI SDK | npm tag               | Git branch  | Status                     |
| ----------------- | ------ | --------------------- | ----------- | -------------------------- |
| `2.x`             | v7     | `latest`, `ai-sdk-v7` | `main`      | active                     |
| `1.x`             | v6     | `ai-sdk-v6`           | `ai-sdk-v6` | maintenance                |
| `0.7.x`           | v5     | `ai-sdk-v5`           | `ai-sdk-v5` | maintenance/critical fixes |
| `0.1.0-ai-sdk-v4` | v4     | `ai-sdk-v4`           | `ai-sdk-v4` | frozen                     |

- Link active docs to `docs/ai-sdk-v7/*`.
- Keep historical docs under their existing SDK-major folders.
- Add v6 users' install command after stable v7:

```bash
npm i ai@^6 ai-sdk-provider-codex-cli@ai-sdk-v6
```

Update `CHANGELOG.md`:

- Add `## [2.0.0] - YYYY-MM-DD`.
- Include:
  - AI SDK v7 compatibility.
  - Node 22+ requirement.
  - ESM-only packaging.
  - Provider interface v4 migration.
  - v7 prompt/file/reasoning compatibility.
  - Codex CLI tested version and model-discovery note.
  - v6 install path via `ai-sdk-v6` dist-tag.

## Implementation phases

### Phase 1: release-line setup

- Cut and push `ai-sdk-v6` from current `main`/`v1.2.2`.
- Add npm `ai-sdk-v6` dist-tag to `1.2.2`.
- Create v7 work branch if not landing directly on `main`.
- Record release/tag hygiene notes.

### Phase 2: dependency and packaging cutover

- Bump AI SDK dependencies to v7 family.
- Raise Node engine to `>=22`.
- Tighten the `zod` peer dependency to the AI SDK v7-compatible range.
- Convert package exports/build to ESM-only: tsup `format: ['esm']`, drop the `require` export condition, remove stale `main`/`module` fields.
- Refresh lockfile.
- Run typecheck to reveal interface drift.

### Phase 3: provider interface and converters

- Rename provider/model/shared types to v4.
- Set provider/model `specificationVersion` to `v4`.
- Update prompt converters for v4 tagged file data.
- Update tool-result converters for v7 canonical `type: 'file'` content entries.
- Add top-level media type handling.
- Add `custom` part warn/skip handling.
- Add `reasoning-file` handling/warnings.
- Map top-level `reasoning` to Codex effort with provider-specific override precedence.
- Keep structured-output schema flow intact.

### Phase 4: app-server protocol and Codex version

- Validate target `@openai/codex` version.
- Regenerate protocol reference with `scripts/sync-protocol-types.sh`.
- Update protocol types/validators/tests only where the current provider consumes those shapes.
- Re-check `listModels()` against explicit Codex path.
- Update docs with tested Codex version and model-discovery guidance.

### Phase 5: focused tests and examples

- Update and add unit tests for v4 converter shapes.
- Update provider-interface tests for v4 stream/content parts.
- Add AI SDK v7 integration smoke tests around text, stream, object generation, raw chunks, image/file inputs, provider options, and app-server approvals.
- Update examples for v7 public API changes.

### Phase 6: docs, changelog, release verification

- Add `docs/ai-sdk-v7/*`.
- Update README compatibility table and active docs links.
- Update `CHANGELOG.md`.
- Build package.
- Run targeted tests.
- Run ESM import smoke.
- Publish prerelease under `next`/`ai-sdk-v7`; promote to stable only after smoke coverage passes.

## Targeted verification plan

Run these after implementation, not as broad project-wide testing by default:

```bash
npm run typecheck
```

Focused converter tests:

```bash
npx vitest run \
  src/__tests__/image-converter.test.ts \
  src/__tests__/image-utils.test.ts \
  src/__tests__/prompt-converter.test.ts \
  src/__tests__/tool-result-converter.test.ts
```

Focused provider/app-server tests:

```bash
npx vitest run \
  src/__tests__/exec-language-model.test.ts \
  src/__tests__/app-server-language-model.test.ts \
  src/__tests__/app-server-stream-emitter.test.ts \
  src/__tests__/app-server-notification-router.test.ts \
  src/__tests__/app-server-rpc-client.test.ts
```

AI SDK v7 smoke scenarios:

- `generateText` text-only prompt.
- `streamText` consuming `result.stream`.
- `generateObject` strict schema.
- `streamObject` JSON streaming.
- app-server image prompt with v4 canonical `{ type: 'file', data: { type: 'data' } }`.
- tool-result content with v7 canonical `{ type: 'file', data: { type: 'data' | 'url' | 'reference' } }`.
- `custom` prompt/tool-result/generated content warns or maps only when intentionally supported.
- remote image prompt behavior for exec and app-server.
- app-server remote URL behavior with and without non-empty `supportedUrls`.
- top-level `reasoning` and provider-specific override precedence.
- raw chunk opt-in.
- provider-executed dynamic tool result and tool approval request stream parts.
- app-server `listModels()` against explicit current Codex path.

Packaging smoke:

```bash
node -e "import('./dist/index.js').then(m => console.log(Object.keys(m).sort().join('\n')))"
```

## Main risks

- **Runtime shape risk:** AI SDK v7 can proxy v3 models to v4, but it does not down-convert v4 prompt/file data. Converter hardening is mandatory even if v3 types temporarily compile.
- **CJS risk (resolved: ESM-only):** `require(esm)` is unflagged only from Node 22.12+ and breaks if the dependency graph gains top-level await, so a CJS entry cannot be reliably supported under `engines.node >=22`.
- **Node support risk:** v7 requires Node 22+, while current package supports Node 18+.
- **Codex binary risk:** installed optional Codex package and global Codex can diverge. Release verification must use explicit paths and versions.
- **Model drift risk:** Codex model slugs changed between docs and live app-server output. Prefer discovery over static catalogs.
- **Approval security risk:** persisted approval semantics are security-sensitive. Do not expose “remember” APIs without exact Codex protocol semantics and tests.
- **Session durability risk:** Codex app-server thread IDs are not automatically Claude-style session stores or file checkpoints. Do not promise transcript portability, fork, or rewind.
- **MCP lifecycle risk:** dynamic MCP changes can leak processes or stale credentials if provider-owned/request-owned lifecycle is not preserved.

## Acceptance criteria for v7 release

- `package.json` and lockfile use AI SDK v7 dependency family, Node 22+, and the tightened v7-compatible `zod` peer range.
- Public provider exports compile as AI SDK v7-compatible native v4 models/providers.
- Exec and app-server prompt converters handle v7 file/image prompt shapes, canonical tool-result file content, `custom` parts, and `reasoning-file` parts or emit explicit unsupported warnings.
- Top-level v7 `reasoning` is mapped or explicitly documented with tested precedence.
- Structured object generation still works for exec and app-server paths.
- App-server streams preserve text, reasoning, raw, dynamic/provider-executed tool, and approval parts.
- `listModels()` works against the release-tested Codex CLI and docs avoid stale model catalogs.
- README compatibility table includes v7/v6/v5/v4 lines and active docs point to `docs/ai-sdk-v7/`.
- Changelog documents breaking changes and install path for v6 users.
- Targeted tests and packaging smokes pass.

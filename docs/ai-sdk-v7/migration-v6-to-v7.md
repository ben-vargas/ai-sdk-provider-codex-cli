# Migrating from 1.x (AI SDK v6) to 2.x (AI SDK v7)

This guide is for users of `ai-sdk-provider-codex-cli` upgrading from the 1.x line (AI SDK v6) to 2.x (AI SDK v7). It covers the provider-specific changes plus the AI SDK 7 API renames most likely to touch code that uses this provider. For the exhaustive SDK-wide list, see the official [AI SDK 7 migration guide](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0).

## Install

```bash
npm i ai@^7 ai-sdk-provider-codex-cli@^2
```

Requirements that changed with 2.0.0:

| Requirement   | 1.x (AI SDK v6)      | 2.x (AI SDK v7)                                    |
| ------------- | -------------------- | -------------------------------------------------- |
| Node.js       | >= 18                | **>= 22**                                          |
| Module format | ESM + CJS            | **ESM-only** (no `require()`)                      |
| zod peer      | `^3.0.0 \|\| ^4.0.0` | `^4.1.8` (Zod 4 only)                              |
| Provider spec | LanguageModelV3      | **LanguageModelV4** (`specificationVersion: 'v4'`) |

## Staying on AI SDK v6

If you are not ready for Node 22 / ESM / AI SDK v7, pin the maintained 1.x line via its dist-tag:

```bash
npm i ai@^6 ai-sdk-provider-codex-cli@ai-sdk-v6
```

The `ai-sdk-v6` branch/tag receives maintenance fixes; `latest` now tracks the v7-compatible 2.x line.

## ESM-Only Packaging

AI SDK v7 packages are ESM-only, and so is this provider. The CJS build and the `require` export condition were removed.

```js
// ❌ no longer works
const { codexExec } = require('ai-sdk-provider-codex-cli');

// ✅ ESM import
import { codexExec } from 'ai-sdk-provider-codex-cli';

// ✅ from CommonJS, if you must
const { codexAppServer } = await import('ai-sdk-provider-codex-cli');
```

Add `"type": "module"` to your `package.json` or use `.mjs` files.

## AI SDK 7 API Renames You Will Hit

These are AI SDK changes (not provider changes), but they affect nearly every snippet in our docs and examples:

| AI SDK 6                                                            | AI SDK 7                                                                               | Notes                                                                                |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `system: '...'`                                                     | `instructions: '...'`                                                                  | `system` still works as a deprecated fallback                                        |
| `result.fullStream`                                                 | `result.stream`                                                                        | `fullStream` is a deprecated alias                                                   |
| `includeRawChunks: true`                                            | `include: { rawChunks: true }`                                                         | top-level option deprecated                                                          |
| `result.providerMetadata` / `.request` / `.response` / `.reasoning` | `result.finalStep.*`                                                                   | top-level aliases deprecated; `await result.finalStep` for `streamText`              |
| `result.totalUsage`                                                 | `result.usage`                                                                         | `usage` now aggregates all steps; `result.finalStep.usage` = old single-step `usage` |
| `usage.cachedInputTokens` / `usage.reasoningTokens`                 | `usage.inputTokenDetails.cacheReadTokens` / `usage.outputTokenDetails.reasoningTokens` | old top-level fields removed                                                         |
| `stepCountIs(n)`                                                    | `isStepCount(n)`                                                                       | tool-loop stop conditions                                                            |
| `onFinish` / `onStepFinish`                                         | `onEnd` / `onStepEnd`                                                                  | old names are deprecated aliases                                                     |

Example, before and after:

```js
// AI SDK 6 + provider 1.x
const result = await streamText({
  model,
  system: 'Be terse.',
  prompt: 'hi',
  includeRawChunks: true,
});
for await (const part of result.fullStream) {
  /* ... */
}
console.log(result.providerMetadata);
```

```js
// AI SDK 7 + provider 2.x
const result = await streamText({
  model,
  instructions: 'Be terse.',
  prompt: 'hi',
  include: { rawChunks: true },
});
for await (const part of result.stream) {
  /* ... */
}
const finalStep = await result.finalStep;
console.log(finalStep.providerMetadata);
```

## System Messages

AI SDK 7 **rejects `{ role: 'system' }` messages inside `prompt`/`messages` by default**. This breaks persisted v6 chats and hand-built message arrays, independent of this provider:

```js
// ❌ throws in AI SDK 7
await generateText({
  model,
  messages: [
    { role: 'system', content: 'Be terse.' },
    { role: 'user', content: 'hi' },
  ],
});

// ✅ move system text to `instructions`
await generateText({
  model,
  instructions: 'Be terse.',
  messages: [{ role: 'user', content: 'hi' }],
});
```

If you must keep existing histories that contain system messages (trusted, server-controlled content only), opt in with `allowSystemInMessages: true`.

## Removed Legacy Model Properties

The 1.x model instances carried v1/v2-era extension properties that AI SDK v7's `LanguageModelV4` interface no longer defines. They were removed in 2.0.0:

- `defaultObjectGenerationMode`
- `supportsStructuredOutputs`
- `supportsImageUrls`

If you introspected these on a model instance, delete that code — object generation and image support work through the standard v7 mechanisms (`responseFormat` and file parts). `supportedUrls` remains and is `{}` for both providers: the AI SDK downloads remote URLs and the provider handles the bytes via temp files.

## Reasoning Option Mapping

AI SDK 7 adds a top-level, provider-agnostic `reasoning` option. Provider 2.x maps it to Codex reasoning effort:

```js
await generateText({
  model: codexExec('gpt-6-astra', { allowNpx: true, skipGitRepoCheck: true }),
  reasoning: 'high',
  prompt: 'Think hard about this.',
});
```

Precedence (highest first):

1. `providerOptions['codex-cli'].reasoningEffort` (exec) / `providerOptions['codex-app-server'].effort` (app-server)
2. top-level `reasoning` (when not `'provider-default'`)
3. constructor settings (`reasoningEffort` / `effort`)
4. Codex defaults

When you adopt the top-level option, **remove overlapping reasoning entries from `providerOptions`** — if both are present, the provider-specific value silently wins. Full details in [configuration.md](./configuration.md#reasoning-precedence).

## Message & Tool-Result File Shapes

AI SDK 7 canonicalizes file inputs. Update message parts when convenient (deprecated shapes are auto-migrated by the SDK at runtime):

```js
// AI SDK 6 style (deprecated)
{ type: 'image', image: imageBuffer, mimeType: 'image/png' }

// AI SDK 7 canonical
{ type: 'file', data: imageBuffer, mediaType: 'image/png' }
```

- `mediaType` accepts a full IANA type (`'image/png'`) or a top-level segment (`'image'`).
- Tool-result content migrated from `image-*` / `file-*` variants to a single canonical `file` variant with tagged `data` (`{ type: 'data' | 'url' | 'reference' | 'text' }`); the provider consumes all of these.
- New v7 part types the provider does **not** support — `custom` and `reasoning-file` — are skipped with an `unsupported` warning instead of failing the call.

See [limitations.md](./limitations.md#prompt--file-inputs) for the full support matrix.

## Model IDs

2.x docs and examples no longer promise a model catalog: slugs are owned by Codex/OpenAI and drift with the installed CLI. Replace hard-coded lists with discovery:

```js
import { listModels } from 'ai-sdk-provider-codex-cli';

const { models, defaultModel } = await listModels();
console.log(
  defaultModel?.id,
  models.map((m) => m.id),
);
```

The app-server provider also exposes `provider.listModels()` over its existing process.

## Checklist

1. `node --version` ≥ 22; project runs as ESM.
2. `npm i ai@^7 ai-sdk-provider-codex-cli@^2` (zod `^4.1.8` required).
3. Replace `require()` with `import`.
4. Rename `system:` → `instructions:`; fix persisted chats containing `{ role: 'system' }`.
5. Rename `result.fullStream` → `result.stream`; `includeRawChunks` → `include: { rawChunks: true }`.
6. Read final-step data from `result.finalStep.*`; usage detail fields from `usage.inputTokenDetails` / `usage.outputTokenDetails`.
7. Delete any use of `defaultObjectGenerationMode`, `supportsStructuredOutputs`, `supportsImageUrls`.
8. Prefer the top-level `reasoning` option; remove overlapping `providerOptions` reasoning keys.
9. Replace hard-coded model lists with `listModels()`.
10. Optionally run the official codemods: `npx @ai-sdk/codemod v7` (see the AI SDK migration guide).

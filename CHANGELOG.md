# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

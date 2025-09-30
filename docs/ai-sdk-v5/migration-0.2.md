# Migration Guide: v0.1.x → v0.2.0

This guide helps you migrate from v0.1.x to v0.2.0 of the AI SDK Provider for Codex CLI.

## Overview

Version 0.2.0 introduces **breaking changes** that significantly improve reliability and token efficiency by leveraging Codex CLI's native JSON schema support.

## Breaking Changes

### 1. Native Schema Support Only

**What changed:**

- Removed prompt engineering for JSON generation
- Removed `extract-json.ts` extraction logic
- All JSON output now uses `--output-schema` (API-enforced)

**Impact:**

- ✅ **Better**: 100-200 fewer tokens per JSON request
- ✅ **Better**: More reliable structured output (API-level enforcement)
- ✅ **Better**: No more manual JSON extraction

**Migration steps:**

- ⚠️ **IMPORTANT**: Check all Zod schemas for unsupported features (see below)
- Remove any manual JSON instructions you added to prompts (they're redundant now)

### OpenAI Strict Mode Limitations

**What changed:**

- OpenAI strict mode does NOT support optional fields
- Format validators (`.email()`, `.url()`, `.uuid()`) are stripped
- Pattern validators (`.regex()`) are stripped

**Impact:**

- ⚠️ **Breaking**: Schemas with `.optional()` will fail
- ⚠️ **Breaking**: Format validators are ignored (no validation)
- ⚠️ **Breaking**: Pattern validators are ignored (no validation)

**Migration steps:**

1. Remove all `.optional()` calls - make fields required or use empty string/null defaults
2. Replace format validators with descriptions:
   - `.email()` → `.describe('Valid email address')`
   - `.url()` → `.describe('Valid URL')`
   - `.uuid()` → `.describe('UUID format')`
3. Replace pattern validators with descriptions:
   - `.regex(/^\d{4}-\d{2}-\d{2}$/)` → `.describe('Date in YYYY-MM-DD format')`

**Example:**

```javascript
// ❌ Before (v0.1.x) - WILL FAIL in v0.2.0
const schema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  website: z.string().url().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// ✅ After (v0.2.0) - Works with OpenAI strict mode
const schema = z.object({
  id: z.string().describe('UUID format'),
  email: z.string().describe('Valid email address'),
  website: z.string().describe('Personal website URL (or empty string if none)'),
  date: z.string().describe('Date in YYYY-MM-DD format'),
});
```

See [LIMITATIONS.md](../../LIMITATIONS.md) for comprehensive details.

### 2. New Event Format

**What changed:**

- Switched from `--json` to `--experimental-json`
- Event structure changed from old format

**Old format (v0.1.x):**

```json
{
  "id": "evt_123",
  "msg": {
    "type": "session_configured",
    "session_id": "abc123"
  }
}
```

**New format (v0.2.0+):**

```json
{
  "type": "session.created",
  "session_id": "abc123"
}
```

**Impact:**

- ✅ **Better**: Structured event types
- ✅ **Better**: Usage tracking from `turn.completed` events
- ⚠️ **Breaking**: Event structure is different (handled internally by provider)

**Migration steps:**

- No action needed if you're using the high-level AI SDK APIs (`generateText`, `generateObject`, etc.)
- If you were parsing raw events, update to new format

### 3. Simplified Internal API

**What changed:**

- Removed `mode` parameter from `mapMessagesToPrompt`
- Removed `jsonSchema` parameter from `mapMessagesToPrompt`
- Removed `PromptMode` type

**Impact:**

- ⚠️ **Breaking**: If you were importing and using `mapMessagesToPrompt` directly
- ✅ **Better**: Simpler internal API

**Migration steps:**

- If you weren't using internal APIs: no action needed
- If you were: update to simplified signature (just pass `prompt`)

## Benefits of v0.2.0

### Token Efficiency

**Before (v0.1.x):**

```
Prompt: CRITICAL: You MUST respond with ONLY a JSON object. NO other text.
Your response MUST start with { and end with }
The JSON MUST match this EXACT schema:
{
  "type": "object",
  "properties": { ... }
}

Now, based on the following conversation, generate ONLY the JSON object:

[Your actual prompt here]
```

**Cost:** ~150 extra tokens

**After (v0.2.0):**

```
[Your actual prompt here]
```

**Cost:** 0 extra tokens (schema passed via `--output-schema`)

### Reliability

**Before (v0.1.x):**

- Prompt engineering → model sometimes adds text outside JSON
- Manual extraction → brittle brace-counting logic
- No API-level enforcement → model can deviate from schema

**After (v0.2.0):**

- Native schema → API enforces with `strict: true`
- No extraction needed → guaranteed valid JSON
- Model cannot deviate from schema

### Code Simplicity

**Removed:**

- ~50 lines of prompt engineering logic
- ~20 lines of JSON extraction logic
- Multiple code paths for different modes

**Result:**

- Simpler, more maintainable codebase
- Fewer edge cases
- Better error handling

## Migration Checklist

### For Most Users

- [ ] Update package: `npm install ai-sdk-provider-codex-cli@0.2.0`
- [ ] **CRITICAL**: Review ALL Zod schemas:
  - [ ] Remove all `.optional()` calls
  - [ ] Replace `.email()`, `.url()`, `.uuid()` with `.describe()`
  - [ ] Replace `.regex()` with `.describe()`
- [ ] Test your existing `generateObject` calls
- [ ] Review prompts and remove any manual JSON instructions
- [ ] Verify output matches expectations
- [ ] Celebrate improved token efficiency! 🎉

### For Advanced Users (using internal APIs)

- [ ] Update `mapMessagesToPrompt` calls if you were using it directly
- [ ] Update event parsing if you were parsing raw CLI events
- [ ] Review custom integrations

### For Library Authors

- [ ] Update to v0.2.0 in your dependencies
- [ ] Test integration with new event format
- [ ] Update documentation to reflect changes

## Example: Before & After

### Before (v0.1.x)

```javascript
import { generateObject } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number().int(),
});

// Provider adds ~150 tokens of JSON instructions to prompt
const { object } = await generateObject({
  model: codexCli('gpt-5'),
  schema,
  prompt: 'Generate a person profile',
});
```

### After (v0.2.0)

```javascript
import { generateObject } from 'ai';
import { codexCli } from 'ai-sdk-provider-codex-cli';
import { z } from 'zod';

const schema = z.object({
  name: z.string(),
  age: z.number().int(),
});

// Provider passes schema via --output-schema (0 extra tokens!)
const { object } = await generateObject({
  model: codexCli('gpt-5'),
  schema,
  prompt: 'Generate a person profile',
});
```

**Result:** Same API, same code, but:

- 150 fewer tokens per request
- More reliable output
- Faster responses

## Troubleshooting

### Issue: "Invalid JSON" errors

**Cause:** Shouldn't happen with native schema enforcement

**Solution:**

1. Verify you're on v0.2.0: `npm list ai-sdk-provider-codex-cli`
2. Check Codex CLI version: `codex --version` (should support `--output-schema`)
3. Report issue with example if problem persists

### Issue: Different output format than expected

**Cause:** Schema validation is now stricter (API-level enforcement)

**Solution:**

1. Review your Zod schema
2. Check for required fields
3. Verify enum values match expectations
4. Use examples to test schema design

### Issue: "Unknown flag: --output-schema"

**Cause:** Your Codex CLI version is too old

**Solution:**

1. Update Codex CLI: `npm install -g @openai/codex@latest`
2. Or use Homebrew: `brew upgrade codex`
3. Verify: `codex --version`

### Issue: Missing usage stats

**Cause:** Usage stats come from `turn.completed` events in experimental JSON format

**Solution:**

1. Verify the provider is using `--experimental-json` (automatic in v0.2.0)
2. Check that Codex CLI is returning usage in events
3. Enable debug logging if needed

## Getting Help

- 📖 Read the [full documentation](./guide.md)
- 🐛 Report issues on [GitHub](https://github.com/ben-vargas/ai-sdk-provider-codex-cli/issues)
- 💬 Ask questions in discussions
- 📝 Check the [CHANGELOG](../../CHANGELOG.md) for detailed changes

## What's Next?

With v0.2.0 stable, future improvements may include:

- Better streaming support when Codex CLI adds it
- More granular event tracking
- Performance optimizations
- Additional configuration options

Stay tuned for updates!

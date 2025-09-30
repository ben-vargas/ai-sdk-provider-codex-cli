# Known Limitations

## Native JSON Schema Support (v0.2.0+)

### Optional Fields Not Supported

**OpenAI's strict mode** (used by `--output-schema`) **does not support optional fields**. All properties in the schema must be in the `required` array.

**Impact:**

- Zod schemas with `.optional()` fields will cause OpenAI API errors
- The API will return 400 Bad Request with message: "required is required to be supplied and to be an array including every key in properties"

**Workaround:**

- Make all fields required in your Zod schema
- Use descriptions to indicate which fields might be empty/null
- Handle optional logic in your application code after receiving the response

**Example that will NOT work:**

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string().optional(), // ❌ Will cause API error
});
```

**Example that WILL work:**

```typescript
const schema = z.object({
  name: z.string(),
  age: z.number(),
  email: z.string(), // ✅ All fields required
});
```

### Schema Sanitization

The provider automatically sanitizes JSON schemas to remove fields not supported by OpenAI's strict mode:

**Removed fields:**

- `$schema` - JSON Schema metadata
- `$id`, `$ref`, `$defs`, `definitions` - Schema references
- `title`, `examples` - Documentation fields (at schema level, property names are preserved)
- `default` - Default values
- `format` - String format validators (e.g., `email`, `uuid`, `url`)
- `pattern` - Regex patterns

**Supported:**

- `minimum`, `maximum` - Numeric constraints
- `minLength`, `maxLength` - String length constraints
- `minItems`, `maxItems` - Array length constraints
- `enum` - Enumerated values
- `type`, `properties`, `required`, `items` - Core schema fields
- `description` - Field descriptions

**Important:** Property names like "title", "format", etc. are preserved - only schema metadata fields are removed.

### No Format/Pattern Validation

Since `format` and `pattern` fields are removed during sanitization:

- Email format (`.email()`) not enforced by API
- URL format (`.url()`) not enforced by API
- UUID format (`.uuid()`) not enforced by API
- Regex patterns (`.regex()`) not enforced by API

**Workaround:** Use descriptions to guide the model, and validate in your application code:

```typescript
const schema = z.object({
  email: z.string().describe('Valid email address'),
  website: z.string().describe('Full URL starting with https://'),
  id: z.string().describe('UUID v4 format'),
});
```

## Other Limitations

### Usage Tracking

Currently returns `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }` for all requests. This is a Codex CLI limitation where `turn.completed` events don't consistently populate usage statistics.

### Streaming

Codex CLI with `--experimental-json` suppresses token deltas during streaming. The final text is delivered as a single chunk at the end, so you won't see incremental streaming of JSON data.

### Color Output

When using `color: 'never'` mode (recommended for parsing), Codex CLI still includes ANSI control sequences in some log lines. The provider filters these out, but it's not 100% reliable.

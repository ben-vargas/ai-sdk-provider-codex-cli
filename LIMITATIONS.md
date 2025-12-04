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

### Image Support

The provider supports multimodal (image) inputs, but with some limitations:

**Not supported:**

- HTTP/HTTPS image URLs - Images must be provided as binary data (Buffer, Uint8Array) or base64 strings
- The AI SDK will pass images as base64 data, which the provider handles correctly

**How it works:**

- Images are written to temporary files
- Passed to Codex CLI via the `--image` flag
- Temp files are automatically cleaned up after the request completes

**Supported formats:**

- Base64 data URLs (`data:image/png;base64,...`)
- Raw base64 strings
- `Buffer` / `Uint8Array` / `ArrayBuffer`

### Usage Tracking

Currently returns `{ inputTokens: 0, outputTokens: 0, totalTokens: 0 }` for all requests. This is a Codex CLI limitation where `turn.completed` events don't consistently populate usage statistics.

### Streaming

**Status:** Not currently supported with `--experimental-json` format (expected in future Codex CLI releases)

The `--experimental-json` output format (introduced in Codex CLI on Sept 25, 2025) currently only emits `item.completed` events with full text content. Incremental streaming via `item.updated` or delta events is **not yet implemented** by OpenAI.

**What this means:**

- `streamText()` works functionally but delivers the entire response in a single chunk after generation completes
- No incremental text deltas - you wait for the full response, then receive it all at once
- The AI SDK's streaming interface is supported, but actual incremental streaming is not available

**Future support:**
The Codex CLI commit message (344d4a1d) explicitly states: "or other item types like `item.output_delta` when we need streaming" and notes "more event types and item types to come."

When OpenAI adds streaming support to the experimental JSON format, this provider will be updated to handle those events and enable true incremental streaming.

### Color Output

When using `color: 'never'` mode (recommended for parsing), Codex CLI still includes ANSI control sequences in some log lines. The provider filters these out, but it's not 100% reliable.

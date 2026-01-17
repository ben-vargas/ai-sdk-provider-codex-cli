import { describe, it, expect } from 'vitest';
import { CodexCliLanguageModel } from '../codex-cli-language-model.js';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

describe('CodexCliLanguageModel schema handling', () => {
  it('sanitizes schemas and writes additionalProperties=false', () => {
    const lastDir = mkdtempSync(join(tmpdir(), 'codex-last-msg-test-'));
    const lastMessagePath = join(lastDir, 'last.txt');

    const model = new CodexCliLanguageModel({
      id: 'gpt-5',
      settings: { codexPath: '/fake/codex.js', outputLastMessageFile: lastMessagePath },
    });

    const rawSchema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Example',
      definitions: {
        nested: {
          type: 'object',
          properties: { keep: { type: 'number', default: 0 } },
        },
      },
      properties: {
        foo: {
          type: 'string',
          $id: 'ignore-me',
          format: 'date-time',
          description: 'kept',
        },
        title: {
          type: 'object',
          description: 'metadata-like key that should remain',
          properties: {
            name: { type: 'string' },
          },
        },
      },
    };

    const { schemaPath, lastMessagePath: resolvedLast } = (
      model as unknown as {
        buildArgs: (
          images?: unknown[],
          responseFormat?: { type: 'json'; schema: unknown },
        ) => { schemaPath?: string; lastMessagePath?: string };
      }
    ).buildArgs([], { type: 'json', schema: rawSchema });

    expect(schemaPath).toBeDefined();
    const sanitized = JSON.parse(readFileSync(schemaPath!, 'utf8'));

    expect(Object.prototype.hasOwnProperty.call(sanitized, '$schema')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized, 'definitions')).toBe(false);
    expect(sanitized.additionalProperties).toBe(false);
    expect(sanitized.properties.foo).toMatchObject({ type: 'string', description: 'kept' });
    expect(Object.prototype.hasOwnProperty.call(sanitized.properties.foo, '$id')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(sanitized.properties.foo, 'format')).toBe(false);
    expect(sanitized.properties.title).toMatchObject({
      type: 'object',
      description: 'metadata-like key that should remain',
    });
    expect(sanitized.properties.title?.properties?.name).toMatchObject({ type: 'string' });

    // Clean up temp files created during buildArgs
    rmSync(dirname(schemaPath!), { recursive: true, force: true });
    if (resolvedLast && resolvedLast !== lastMessagePath) {
      rmSync(dirname(resolvedLast), { recursive: true, force: true });
    }
    rmSync(lastDir, { recursive: true, force: true });
  });
});

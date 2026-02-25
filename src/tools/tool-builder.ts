import type { ZodType } from 'zod';

export interface LocalToolDefinition<TParams = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: ZodType<TParams>;
  execute: (params: TParams) => Promise<TResult>;
}

export interface LocalTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (params: unknown) => Promise<unknown>;
}

function zodToJsonSchema(schema: ZodType<unknown>): Record<string, unknown> {
  const zodWithJson = schema as unknown as {
    toJSON?: () => Record<string, unknown>;
  };
  if (typeof zodWithJson.toJSON === 'function') {
    try {
      return zodWithJson.toJSON();
    } catch {
      // fall back below
    }
  }

  const globalZ = (globalThis as unknown as { z?: { toJSONSchema?: (value: unknown) => unknown } })
    .z;
  if (globalZ?.toJSONSchema) {
    try {
      const converted = globalZ.toJSONSchema(schema);
      if (converted && typeof converted === 'object') {
        return converted as Record<string, unknown>;
      }
    } catch {
      // fall back below
    }
  }

  const definition = (schema as unknown as { _def?: { typeName?: string } })._def;
  if (definition?.typeName === 'ZodString') return { type: 'string' };
  if (definition?.typeName === 'ZodNumber') return { type: 'number' };
  if (definition?.typeName === 'ZodBoolean') return { type: 'boolean' };

  return { type: 'object' };
}

export function tool<TParams, TResult>(
  definition: LocalToolDefinition<TParams, TResult>,
): LocalTool {
  const { name, description, parameters, execute } = definition;

  return {
    name,
    description,
    inputSchema: zodToJsonSchema(parameters as unknown as ZodType<unknown>),
    execute: async (params: unknown) => {
      const parsed = parameters.parse(params) as TParams;
      return await execute(parsed);
    },
  };
}

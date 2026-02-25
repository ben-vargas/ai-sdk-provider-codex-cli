import { z, type ZodType } from 'zod';

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

type JsonSchema = Record<string, unknown>;

function fromSchemaMethod(schema: ZodType<unknown>): JsonSchema | undefined {
  const withToJSON = schema as unknown as {
    toJSON?: () => JsonSchema;
  };

  if (typeof withToJSON.toJSON !== 'function') {
    return undefined;
  }

  try {
    return withToJSON.toJSON();
  } catch {
    return undefined;
  }
}

function fromZodToJsonSchema(schema: ZodType<unknown>): JsonSchema | undefined {
  const zodWithConverter = z as unknown as {
    toJSONSchema?: (value: unknown, options?: Record<string, unknown>) => unknown;
  };

  if (typeof zodWithConverter.toJSONSchema !== 'function') {
    return undefined;
  }

  try {
    const converted = zodWithConverter.toJSONSchema(schema, {
      io: 'input',
      target: 'jsonSchema7',
    });
    if (converted && typeof converted === 'object') {
      return converted as JsonSchema;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function getDef(schema: ZodType<unknown>): Record<string, unknown> {
  return (schema as unknown as { _def?: Record<string, unknown> })._def ?? {};
}

function getTypeName(def: Record<string, unknown>): string | undefined {
  const typeName = def.typeName;
  if (typeof typeName === 'string') {
    return typeName;
  }

  const type = def.type;
  if (typeof type === 'string') {
    return `Zod${type.charAt(0).toUpperCase()}${type.slice(1)}`;
  }

  return undefined;
}

function toJsonSchemaFallback(schema: ZodType<unknown>): JsonSchema {
  const def = getDef(schema);
  const typeName = getTypeName(def);

  if (typeName === 'ZodString') return { type: 'string' };
  if (typeName === 'ZodNumber') return { type: 'number' };
  if (typeName === 'ZodBoolean') return { type: 'boolean' };
  if (typeName === 'ZodNull') return { type: 'null' };
  if (typeName === 'ZodAny' || typeName === 'ZodUnknown') return {};

  if (typeName === 'ZodLiteral') {
    const value = def.value;
    if (value === null) {
      return { type: 'null', const: value };
    }

    return {
      type: typeof value,
      const: value,
    };
  }

  if (typeName === 'ZodEnum') {
    const values = def.values;
    if (Array.isArray(values)) {
      return {
        type: 'string',
        enum: values,
      };
    }
  }

  if (typeName === 'ZodObject') {
    const rawShape = def.shape;
    const shape = typeof rawShape === 'function' ? rawShape() : rawShape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];

    if (shape && typeof shape === 'object') {
      for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
        if (!(value instanceof z.ZodType)) continue;
        properties[key] = toJsonSchema(value as ZodType<unknown>);

        const valueDef = getDef(value as ZodType<unknown>);
        const valueTypeName = getTypeName(valueDef);
        if (valueTypeName !== 'ZodOptional' && valueTypeName !== 'ZodDefault') {
          required.push(key);
        }
      }
    }

    const schemaObject: JsonSchema = {
      type: 'object',
      properties,
    };

    if (required.length > 0) {
      schemaObject.required = required;
    }

    return schemaObject;
  }

  if (typeName === 'ZodArray') {
    const itemType = def.type;
    if (itemType instanceof z.ZodType) {
      return {
        type: 'array',
        items: toJsonSchema(itemType as ZodType<unknown>),
      };
    }

    return { type: 'array', items: {} };
  }

  if (typeName === 'ZodTuple') {
    const tupleItems = def.items;
    if (Array.isArray(tupleItems)) {
      const prefixItems = tupleItems
        .filter((item): item is ZodType<unknown> => item instanceof z.ZodType)
        .map((item) => toJsonSchema(item));
      return {
        type: 'array',
        prefixItems,
        minItems: prefixItems.length,
        maxItems: prefixItems.length,
      };
    }

    return { type: 'array' };
  }

  if (typeName === 'ZodRecord') {
    const valueType = def.valueType;
    if (valueType instanceof z.ZodType) {
      return {
        type: 'object',
        additionalProperties: toJsonSchema(valueType),
      };
    }

    return {
      type: 'object',
      additionalProperties: {},
    };
  }

  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    const inner = def.innerType;
    if (inner instanceof z.ZodType) {
      return toJsonSchema(inner as ZodType<unknown>);
    }
    return {};
  }

  if (typeName === 'ZodNullable') {
    const innerType = def.innerType;
    if (innerType instanceof z.ZodType) {
      return {
        anyOf: [toJsonSchema(innerType as ZodType<unknown>), { type: 'null' }],
      };
    }
    return { anyOf: [{}, { type: 'null' }] };
  }

  if (typeName === 'ZodUnion') {
    const options = def.options;
    if (Array.isArray(options)) {
      const converted = options
        .filter((option): option is ZodType<unknown> => option instanceof z.ZodType)
        .map((option) => toJsonSchema(option));
      return {
        anyOf: converted,
      };
    }
  }

  if (typeName === 'ZodDiscriminatedUnion') {
    const options = def.options;
    if (options && typeof options === 'object') {
      const values = Array.from((options as Map<unknown, unknown>).values()).filter(
        (option): option is ZodType<unknown> => option instanceof z.ZodType,
      );
      return {
        anyOf: values.map((option) => toJsonSchema(option)),
      };
    }
  }

  if (typeName === 'ZodEffects' || typeName === 'ZodPipeline') {
    const inner = def.schema ?? def.in ?? def.out;
    if (inner instanceof z.ZodType) {
      return toJsonSchema(inner as ZodType<unknown>);
    }
  }

  return { type: 'object' };
}

function toJsonSchema(schema: ZodType<unknown>): JsonSchema {
  return fromSchemaMethod(schema) ?? fromZodToJsonSchema(schema) ?? toJsonSchemaFallback(schema);
}

export function tool<TParams, TResult>(
  definition: LocalToolDefinition<TParams, TResult>,
): LocalTool {
  const { name, description, parameters, execute } = definition;

  return {
    name,
    description,
    inputSchema: toJsonSchema(parameters as unknown as ZodType<unknown>),
    execute: async (params: unknown) => {
      const parsed = parameters.parse(params) as TParams;
      return await execute(parsed);
    },
  };
}

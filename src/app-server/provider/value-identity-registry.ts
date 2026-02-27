import type { Logger } from '../../types-shared.js';

export interface ValueIdentityRegistry {
  loggerIdentity(value: Logger | false | undefined): string;
  functionIdentity(value: (...args: unknown[]) => unknown): string;
  objectIdentity(value: object): string;
}

export function createValueIdentityRegistry(): ValueIdentityRegistry {
  const loggerIdentityIds = new WeakMap<Logger, number>();
  const functionIdentityIds = new WeakMap<(...args: unknown[]) => unknown, number>();
  const objectIdentityIds = new WeakMap<object, number>();
  let nextLoggerIdentityId = 1;
  let nextValueIdentityId = 1;

  return {
    loggerIdentity(value) {
      if (value === false) {
        return 'logger:false';
      }
      if (!value) {
        return 'logger:default';
      }

      const existing = loggerIdentityIds.get(value);
      if (existing !== undefined) {
        return `logger:${existing}`;
      }

      const id = nextLoggerIdentityId++;
      loggerIdentityIds.set(value, id);
      return `logger:${id}`;
    },
    functionIdentity(value) {
      const existing = functionIdentityIds.get(value);
      if (existing !== undefined) {
        return `fn:${existing}`;
      }

      const id = nextValueIdentityId++;
      functionIdentityIds.set(value, id);
      return `fn:${id}`;
    },
    objectIdentity(value) {
      const existing = objectIdentityIds.get(value);
      if (existing !== undefined) {
        return `obj:${existing}`;
      }

      const id = nextValueIdentityId++;
      objectIdentityIds.set(value, id);
      return `obj:${id}`;
    },
  };
}

import { AppServerLanguageModel } from '../language-model.js';

export interface PersistentModelCache {
  get(key: string): AppServerLanguageModel | undefined;
  set(key: string, model: AppServerLanguageModel): void;
  clear(): void;
}

export function createPersistentModelCache(): PersistentModelCache {
  const cache = new Map<string, AppServerLanguageModel>();

  return {
    get(key) {
      return cache.get(key);
    },
    set(key, model) {
      cache.set(key, model);
    },
    clear() {
      cache.clear();
    },
  };
}

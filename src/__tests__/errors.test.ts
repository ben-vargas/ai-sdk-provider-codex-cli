import { describe, it, expect } from 'vitest';
import {
  createAPICallError,
  createAuthenticationError,
  isAuthenticationError,
  isUnsupportedFeatureError,
  UnsupportedFeatureError,
} from '../errors.js';

describe('errors', () => {
  it('creates API call error with metadata', () => {
    const err = createAPICallError({
      message: 'boom',
      code: 'EFAIL',
      exitCode: 2,
      stderr: 'oops',
      promptExcerpt: 'hi',
    });
    expect((err as any).data).toMatchObject({
      code: 'EFAIL',
      exitCode: 2,
      stderr: 'oops',
      promptExcerpt: 'hi',
    });
  });

  it('authentication error helper is detected', () => {
    const err = createAuthenticationError('auth');
    expect(isAuthenticationError(err)).toBe(true);
  });

  it('detects APICallError authentication metadata', () => {
    const err = createAPICallError({
      message: 'unauthorized',
      code: '401',
    });
    expect(isAuthenticationError(err)).toBe(true);
  });

  it('unsupported feature helper is detected', () => {
    const err = new UnsupportedFeatureError({
      feature: 'model/list',
      minCodexVersion: '0.105.0',
      serverVersion: '0.104.0',
    });
    expect(isUnsupportedFeatureError(err)).toBe(true);
  });
});

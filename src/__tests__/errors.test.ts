import { describe, it, expect } from 'vitest';
import { createAPICallError, createAuthenticationError, isAuthenticationError } from '../errors.js';

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
});

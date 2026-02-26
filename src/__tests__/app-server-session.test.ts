import { describe, expect, it, vi } from 'vitest';
import { AppServerSession } from '../app-server/session.js';

describe('AppServerSession', () => {
  it('injects messages via turn/start and interrupts active turns', async () => {
    const turnStart = vi.fn().mockResolvedValue({ turn: { id: 'turn_2' } });
    const turnInterrupt = vi.fn().mockResolvedValue({});
    const registerRequestContext = vi.fn().mockReturnValue('ctx_1');
    const bindRequestContext = vi.fn();
    const clearRequestContext = vi.fn();
    const hasTurnCompleted = vi.fn().mockReturnValue(false);
    const withThreadLock = vi.fn(
      async (_threadId: string, fn: () => Promise<unknown>) => await fn(),
    );

    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.3-codex',
      client: {
        registerRequestContext,
        bindRequestContext,
        clearRequestContext,
        hasTurnCompleted,
        withThreadLock,
        turnStart,
        turnInterrupt,
      } as never,
      requestHandlers: {
        onDynamicToolCall: async () => ({ contentItems: [], success: true }),
      },
      autoApprove: true,
    });

    session.setTurnId('turn_1');
    await session.injectMessage('follow-up');

    expect(withThreadLock).toHaveBeenCalledWith('thr_1', expect.any(Function));
    expect(registerRequestContext).toHaveBeenCalledWith('thr_1', {
      handlers: {
        onDynamicToolCall: expect.any(Function),
      },
      autoApprove: true,
    });
    expect(turnStart).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thr_1',
        model: 'gpt-5.3-codex',
      }),
    );
    expect(bindRequestContext).toHaveBeenCalledWith('ctx_1', 'turn_2');
    expect(clearRequestContext).not.toHaveBeenCalled();
    expect(session.turnId).toBe('turn_2');
    expect(session.isActive()).toBe(true);

    await session.interrupt();
    expect(turnInterrupt).toHaveBeenCalledWith({ threadId: 'thr_1', turnId: 'turn_2' });
    expect(session.isActive()).toBe(false);
  });

  it('clears pending request context when injected turn/start fails', async () => {
    const turnStart = vi.fn().mockRejectedValue(new Error('turn start failed'));
    const registerRequestContext = vi.fn().mockReturnValue('ctx_2');
    const bindRequestContext = vi.fn();
    const clearRequestContext = vi.fn();
    const hasTurnCompleted = vi.fn().mockReturnValue(false);
    const withThreadLock = vi.fn(
      async (_threadId: string, fn: () => Promise<unknown>) => await fn(),
    );

    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.3-codex',
      client: {
        registerRequestContext,
        bindRequestContext,
        clearRequestContext,
        hasTurnCompleted,
        withThreadLock,
        turnStart,
      } as never,
    });

    await expect(session.injectMessage('follow-up')).rejects.toThrow('turn start failed');
    expect(bindRequestContext).not.toHaveBeenCalled();
    expect(clearRequestContext).toHaveBeenCalledWith('ctx_2');
  });

  it('does not mark session inactive when a different turn completes', async () => {
    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.3-codex',
      client: {} as never,
    });

    session.setTurnId('turn_original');
    session.setTurnId('turn_injected');
    session.setInactive('turn_original');
    expect(session.isActive()).toBe(true);

    session.setInactive('turn_injected');
    expect(session.isActive()).toBe(false);
  });

  it('does not clobber active state for a newer turn when interrupt resolves late', async () => {
    let resolveInterrupt: (() => void) | undefined;
    const turnInterrupt = vi.fn(
      async () =>
        await new Promise<void>((resolve) => {
          resolveInterrupt = resolve;
        }),
    );

    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.3-codex',
      client: {
        turnInterrupt,
      } as never,
    });

    session.setTurnId('turn_1');
    const interruptPromise = session.interrupt();
    session.setTurnId('turn_2');
    resolveInterrupt?.();
    await interruptPromise;

    expect(session.turnId).toBe('turn_2');
    expect(session.isActive()).toBe(true);
    expect(turnInterrupt).toHaveBeenCalledWith({ threadId: 'thr_1', turnId: 'turn_1' });
  });

  it('refreshes active state when current turn is already completed', () => {
    const hasTurnCompleted = vi.fn().mockReturnValue(true);
    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.3-codex',
      client: {
        hasTurnCompleted,
      } as never,
    });

    session.setTurnId('turn_done');
    expect(session.isActive()).toBe(false);
  });

  it('interrupt is a no-op for turns that completed before interrupt call', async () => {
    const hasTurnCompleted = vi.fn().mockReturnValue(true);
    const turnInterrupt = vi.fn();
    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.3-codex',
      client: {
        hasTurnCompleted,
        turnInterrupt,
      } as never,
    });

    session.setTurnId('turn_done');
    await session.interrupt();

    expect(turnInterrupt).not.toHaveBeenCalled();
    expect(session.isActive()).toBe(false);
  });
});

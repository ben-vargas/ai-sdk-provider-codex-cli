import { describe, expect, it, vi } from 'vitest';
import { AppServerSession } from '../app-server-session.js';

describe('AppServerSession', () => {
  it('injects messages via turn/start and interrupts active turns', async () => {
    const turnStart = vi.fn().mockResolvedValue({ turn: { id: 'turn_2' } });
    const turnInterrupt = vi.fn().mockResolvedValue({});

    const session = new AppServerSession({
      threadId: 'thr_1',
      modelId: 'gpt-5.1-codex',
      client: {
        turnStart,
        turnInterrupt,
      } as never,
    });

    session.setTurnId('turn_1');
    await session.injectMessage('follow-up');

    expect(turnStart).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thr_1',
        model: 'gpt-5.1-codex',
      }),
    );
    expect(session.turnId).toBe('turn_2');
    expect(session.isActive()).toBe(true);

    await session.interrupt();
    expect(turnInterrupt).toHaveBeenCalledWith({ threadId: 'thr_1', turnId: 'turn_2' });
    expect(session.isActive()).toBe(false);
  });
});

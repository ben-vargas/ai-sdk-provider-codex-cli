import { describe, it, expect } from 'vitest';
import { mapMessagesToPrompt } from '../message-mapper.js';

describe('mapMessagesToPrompt', () => {
  it('maps system + user + assistant', () => {
    const { promptText } = mapMessagesToPrompt([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ] as any);

    expect(promptText).toContain('Be concise.');
    expect(promptText).toContain('Human: Hi');
    expect(promptText).toContain('Assistant: Hello!');
    expect(promptText).toContain('Human: How are you?');
  });

  it('warns on image parts', () => {
    const { warnings } = mapMessagesToPrompt([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'See this' },
          { type: 'image', url: 'http://example.com/img.png' },
        ],
      },
    ] as any);

    expect(warnings?.some((w) => w.toLowerCase().includes('image'))).toBe(true);
  });

  it('does not inject JSON-specific instructions', () => {
    const { promptText } = mapMessagesToPrompt([{ role: 'user', content: 'Data please' }] as any);
    expect(promptText).not.toContain('CRITICAL:');
  });
});

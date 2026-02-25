import { describe, expect, it } from 'vitest';
import { convertPromptToCodexInput } from '../converters/prompt-converter.js';

describe('prompt-converter', () => {
  it('collects all system messages and formats stateless transcript', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        { role: 'system', content: 'First system' },
        { role: 'system', content: 'Second system' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'User text' },
            { type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' },
          ],
        },
        {
          role: 'assistant',
          content: [
            { type: 'reasoning', text: 'I should think' },
            { type: 'tool-call', toolName: 'search', toolCallId: 'c1', input: { q: 'foo' } },
            {
              type: 'tool-result',
              toolName: 'search',
              toolCallId: 'c1',
              output: { type: 'json', value: { ok: true } },
            },
            { type: 'text', text: 'Assistant text' },
          ],
        },
        {
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolName: 'search',
              toolCallId: 'c1',
              output: { type: 'text', value: 'done' },
            },
            {
              type: 'tool-approval-response',
              approvalId: 'a1',
              approved: false,
              reason: 'no',
            },
          ],
        },
      ] as never,
    });

    expect(converted.systemInstruction).toBe('First system\n\nSecond system');
    expect(converted.text).toContain('User: User text');
    expect(converted.text).toContain('Assistant: Assistant text');
    expect(converted.text).toContain('Assistant Reasoning: I should think');
    expect(converted.text).toContain('Tool Call (search): {"q":"foo"}');
    expect(converted.text).toContain('Tool Result (search): {"ok":true}');
    expect(converted.text).toContain('Tool Approval (a1): denied (no)');
    expect(converted.localImages).toHaveLength(1);
    expect(converted.remoteImageUrls).toEqual([]);
  });

  it('keeps only latest user turn in persistent mode and warns', () => {
    const converted = convertPromptToCodexInput({
      mode: 'persistent',
      prompt: [
        { role: 'user', content: [{ type: 'text', text: 'older' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'assistant reply' }] },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'newer' },
            { type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,BBBB' },
          ],
        },
      ] as never,
    });

    expect(converted.text).toBe('newer');
    expect(converted.localImages).toHaveLength(1);
    expect(
      converted.warnings.some(
        (warning) =>
          warning.type === 'other' && warning.message.includes('Stateful mode ignores earlier'),
      ),
    ).toBe(true);
  });

  it('maps remote image URLs to remote inputs', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'file', mediaType: 'image/webp', data: 'https://example.com/cat.webp' },
            { type: 'image', image: 'https://example.com/dog.png' },
          ],
        },
      ] as never,
    });

    expect(converted.localImages).toHaveLength(0);
    expect(converted.remoteImageUrls).toEqual([
      'https://example.com/cat.webp',
      'https://example.com/dog.png',
    ]);
  });

  it('warns for unsupported non-image file media types', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'user',
          content: [
            {
              type: 'file',
              mediaType: 'application/pdf',
              data: 'data:application/pdf;base64,QQ==',
            },
          ],
        },
      ] as never,
    });

    expect(
      converted.warnings.some(
        (warning) =>
          warning.type === 'unsupported' && warning.details.includes('Unsupported file mediaType'),
      ),
    ).toBe(true);
  });

  it('warns for malformed tool-call parts without toolCallId', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolName: 'search',
              input: { q: 'missing id' },
            },
          ],
        },
      ] as never,
    });

    expect(converted.text).not.toContain('Tool Call (search):');
    expect(
      converted.warnings.some(
        (warning) =>
          warning.type === 'unsupported' &&
          warning.details.includes('Malformed assistant tool-call part'),
      ),
    ).toBe(true);
  });

  it('warns for malformed tool-call parts without toolName', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: 'call_1',
              input: { q: 'missing toolName' },
            },
          ],
        },
      ] as never,
    });

    expect(converted.text).not.toContain('Tool Call (');
    expect(
      converted.warnings.some(
        (warning) =>
          warning.type === 'unsupported' &&
          warning.details.includes('Malformed assistant tool-call part'),
      ),
    ).toBe(true);
  });

  it('warns for malformed tool-call parts without input', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolName: 'search',
              toolCallId: 'call_1',
            },
          ],
        },
      ] as never,
    });

    expect(converted.text).not.toContain('Tool Call (search):');
    expect(
      converted.warnings.some(
        (warning) =>
          warning.type === 'unsupported' &&
          warning.details.includes('Malformed assistant tool-call part'),
      ),
    ).toBe(true);
  });

  it('handles string content messages for user and assistant roles', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        { role: 'user', content: 'User from string' },
        { role: 'assistant', content: 'Assistant from string' },
      ] as never,
    });

    expect(converted.text).toContain('User: User from string');
    expect(converted.text).toContain('Assistant: Assistant from string');
  });

  it('joins multiple user image parts into one attachment marker count', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Please inspect' },
            { type: 'file', mediaType: 'image/png', data: 'data:image/png;base64,AAAA' },
            { type: 'image', image: 'https://example.com/remote.jpg' },
          ],
        },
      ] as never,
    });

    expect(converted.text).toContain('User: Please inspect');
    expect(converted.text).toContain('[2 images attached]');
    expect(converted.localImages).toHaveLength(1);
    expect(converted.remoteImageUrls).toEqual(['https://example.com/remote.jpg']);
  });

  it('drops empty system instruction segments', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        { role: 'system', content: '' },
        { role: 'system', content: [{ type: 'text', text: '   ' }] },
        { role: 'user', content: 'hello' },
      ] as never,
    });

    expect(converted.systemInstruction).toBeUndefined();
  });

  it('keeps assistant reasoning-only messages without adding blank assistant text line', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'assistant',
          content: [{ type: 'reasoning', text: 'thinking only' }],
        },
      ] as never,
    });

    expect(converted.text).toContain('Assistant Reasoning: thinking only');
    expect(converted.text).not.toContain('Assistant:');
  });

  it('ignores empty reasoning text after trimming', () => {
    const converted = convertPromptToCodexInput({
      mode: 'stateless',
      prompt: [
        {
          role: 'assistant',
          content: [{ type: 'reasoning', text: '   ' }],
        },
      ] as never,
    });

    expect(converted.text).toBe('');
  });
});

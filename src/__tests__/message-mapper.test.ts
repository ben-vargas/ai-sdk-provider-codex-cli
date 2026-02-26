import { describe, it, expect } from 'vitest';
import { mapMessagesToPrompt } from '../message-mapper.js';

describe('mapMessagesToPrompt', () => {
  it('maps system + user + assistant', () => {
    const { promptText, images } = mapMessagesToPrompt([
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello!' },
      { role: 'user', content: 'How are you?' },
    ] as any);

    expect(promptText).toContain('Be concise.');
    expect(promptText).toContain('User: Hi');
    expect(promptText).toContain('Assistant: Hello!');
    expect(promptText).toContain('User: How are you?');
    expect(images).toEqual([]);
  });

  it('does not inject JSON-specific instructions', () => {
    const { promptText } = mapMessagesToPrompt([{ role: 'user', content: 'Data please' }] as any);
    expect(promptText).not.toContain('CRITICAL:');
  });

  describe('image handling', () => {
    it('extracts image parts with data URL', () => {
      const { images, warnings } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'See this' },
            { type: 'image', image: 'data:image/png;base64,YWJjMTIz' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(1);
      expect(images[0]?.data).toBe('data:image/png;base64,YWJjMTIz');
      expect(
        warnings?.some(
          (w) =>
            w.type === 'other' &&
            typeof w.message === 'string' &&
            w.message.toLowerCase().includes('ignored'),
        ),
      ).toBeFalsy();
    });

    it('extracts multiple images from single message', () => {
      const { images } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Compare these' },
            { type: 'image', image: 'data:image/png;base64,aW1nMQ==' },
            { type: 'image', image: 'data:image/jpeg;base64,aW1nMg==', mimeType: 'image/jpeg' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(2);
      expect(images[0]?.data).toBe('data:image/png;base64,aW1nMQ==');
      expect(images[1]?.data).toBe('data:image/jpeg;base64,aW1nMg==');
    });

    it('extracts images from multiple messages', () => {
      const { images } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'First image' },
            { type: 'image', image: 'data:image/png;base64,Zmlyc3Q=' },
          ],
        },
        { role: 'assistant', content: 'I see it' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Second image' },
            { type: 'image', image: 'data:image/png;base64,c2Vjb25k' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(2);
    });

    it('warns on unsupported HTTP URL images', () => {
      const { images, warnings } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'See this' },
            { type: 'image', url: 'http://example.com/img.png' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(0);
      expect(
        warnings?.some(
          (w) =>
            w.type === 'unsupported' &&
            typeof w.details === 'string' &&
            w.details.toLowerCase().includes('unsupported'),
        ),
      ).toBe(true);
    });

    it('does not claim image attachments when only remote URLs are dropped in exec mode', () => {
      const { promptText } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this image' },
            { type: 'image', url: 'https://example.com/image.png' },
          ],
        },
      ] as any);

      expect(promptText).not.toContain('[1 image attached]');
      expect(promptText).not.toContain('[1 images attached]');
    });

    it('handles mixed valid and invalid images', () => {
      const { images, warnings } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Images' },
            { type: 'image', image: 'data:image/png;base64,dmFsaWQ=' },
            { type: 'image', url: 'https://example.com/invalid.png' },
            { type: 'image', image: 'data:image/jpeg;base64,YWxzb3ZhbGlk' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(2);
      expect(warnings).toHaveLength(1);
    });

    it('handles base64 string without data URL prefix', () => {
      const { images } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Raw base64' },
            { type: 'image', image: 'iVBORw0KGgo=', mimeType: 'image/png' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(1);
      expect(images[0]?.data).toBe('data:image/png;base64,iVBORw0KGgo=');
    });

    it('handles Buffer image input', () => {
      const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const { images } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Buffer image' },
            { type: 'image', image: buffer, mimeType: 'image/png' },
          ],
        },
      ] as any);

      expect(images).toHaveLength(1);
      expect(images[0]?.data).toMatch(/^data:image\/png;base64,/);
    });

    it('handles AI SDK v6 file parts for image input', () => {
      const buffer = Buffer.from([0x52, 0x49, 0x46, 0x46]); // RIFF
      const { images } = mapMessagesToPrompt([
        {
          role: 'user',
          content: [
            { type: 'text', text: 'File part image' },
            { type: 'file', mediaType: 'image/webp', data: buffer },
          ],
        },
      ] as any);

      expect(images).toHaveLength(1);
      expect(images[0]?.data).toMatch(/^data:image\/webp;base64,/);
      expect(images[0]?.mimeType).toBe('image/webp');
    });
  });
});

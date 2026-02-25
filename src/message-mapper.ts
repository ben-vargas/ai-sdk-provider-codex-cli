import type { ModelMessage } from 'ai';
import { convertPromptToCodexInput, type PromptMessage } from './converters/index.js';
import type { ImageData } from './image-utils.js';

export type { ImageData };

export function mapMessagesToPrompt(prompt: readonly ModelMessage[]): {
  promptText: string;
  images: ImageData[];
  warnings?: string[];
} {
  const converted = convertPromptToCodexInput({
    prompt: prompt as unknown as readonly PromptMessage[],
    mode: 'stateless',
  });

  const warnings = [...converted.warnings];
  if (converted.remoteImageUrls.length > 0) {
    warnings.push('Unsupported image format in message (HTTP URLs not supported)');
  }

  const promptParts: string[] = [];
  if (converted.systemInstruction) {
    promptParts.push(converted.systemInstruction);
  }
  if (converted.text) {
    promptParts.push(converted.text);
  }

  return {
    promptText: promptParts.join('\n\n'),
    images: converted.localImages,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

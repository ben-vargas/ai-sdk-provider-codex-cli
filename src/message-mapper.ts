import type { ModelMessage } from 'ai';
import type { SharedV3Warning } from '@ai-sdk/provider';
import { convertPromptToCodexInput, type PromptMessage } from './converters/index.js';
import type { ImageData } from './image-utils.js';

export type { ImageData };

export function mapMessagesToPrompt(prompt: readonly ModelMessage[]): {
  promptText: string;
  images: ImageData[];
  warnings?: SharedV3Warning[];
} {
  const converted = convertPromptToCodexInput({
    prompt: prompt as unknown as readonly PromptMessage[],
    mode: 'stateless',
    includeRemoteImagesInMarkers: false,
  });

  const warnings: SharedV3Warning[] = converted.warnings.map((warning) =>
    warning.type === 'unsupported'
      ? {
          type: 'unsupported',
          feature: warning.feature,
          details: warning.details,
        }
      : {
          type: 'other',
          message: warning.message,
        },
  );
  if (converted.remoteImageUrls.length > 0) {
    warnings.push({
      type: 'unsupported',
      feature: 'prompt.user.image.remote-url.exec',
      details: 'Unsupported image format in message (HTTP URLs not supported)',
    });
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

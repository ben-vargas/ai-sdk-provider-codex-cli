import type { ModelMessage } from 'ai';
import { extractImageData, type ImageData, type ImagePart } from './image-utils.js';

export type { ImageData };

type TextPart = { type: 'text'; text: string };
type ToolOutputText = { type: 'text'; value: string };
type ToolOutputJson = { type: 'json'; value: unknown };
type ToolItem = { toolName: string; output: ToolOutputText | ToolOutputJson };

function isTextPart(p: unknown): p is TextPart {
  return (
    typeof p === 'object' &&
    p !== null &&
    'type' in p &&
    (p as { type?: unknown }).type === 'text' &&
    'text' in p &&
    typeof (p as { text?: unknown }).text === 'string'
  );
}

function isImagePart(p: unknown): p is ImagePart {
  return (
    typeof p === 'object' && p !== null && 'type' in p && (p as { type?: unknown }).type === 'image'
  );
}

function isToolItem(p: unknown): p is ToolItem {
  if (typeof p !== 'object' || p === null) return false;
  const obj = p as { toolName?: unknown; output?: unknown };
  if (typeof obj.toolName !== 'string') return false;
  const out = obj.output as { type?: unknown; value?: unknown } | undefined;
  if (!out || (out.type !== 'text' && out.type !== 'json')) return false;
  if (out.type === 'text' && typeof out.value !== 'string') return false;
  return true;
}

export function mapMessagesToPrompt(prompt: readonly ModelMessage[]): {
  promptText: string;
  images: ImageData[];
  warnings?: string[];
} {
  const warnings: string[] = [];
  const parts: string[] = [];
  const images: ImageData[] = [];

  let systemText: string | undefined;

  for (const msg of prompt) {
    if (msg.role === 'system') {
      systemText = typeof msg.content === 'string' ? msg.content : String(msg.content);
      continue;
    }

    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        parts.push(`Human: ${msg.content}`);
      } else if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter(isTextPart)
          .map((p) => p.text)
          .join('\n');
        if (text) parts.push(`Human: ${text}`);

        // Extract images instead of warning
        for (const part of msg.content.filter(isImagePart)) {
          const imageData = extractImageData(part);
          if (imageData) {
            images.push(imageData);
          } else {
            warnings.push('Unsupported image format in message (HTTP URLs not supported)');
          }
        }
      }
      continue;
    }

    if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        parts.push(`Assistant: ${msg.content}`);
      } else if (Array.isArray(msg.content)) {
        const text = msg.content
          .filter(isTextPart)
          .map((p) => p.text)
          .join('\n');
        if (text) parts.push(`Assistant: ${text}`);
      }
      continue;
    }

    if (msg.role === 'tool') {
      if (Array.isArray(msg.content)) {
        for (const maybeTool of msg.content) {
          if (!isToolItem(maybeTool)) continue;
          const value =
            maybeTool.output.type === 'text'
              ? maybeTool.output.value
              : JSON.stringify(maybeTool.output.value);
          parts.push(`Tool Result (${maybeTool.toolName}): ${value}`);
        }
      }
      continue;
    }
  }

  let promptText = '';
  if (systemText) promptText += systemText + '\n\n';
  promptText += parts.join('\n\n');

  return { promptText, images, ...(warnings.length ? { warnings } : {}) };
}

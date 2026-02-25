import type { ConvertedToolResult, ConvertedWarning, NormalizedToolOutput } from './types.js';

export function safeJsonStringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

export function formatToolResultOutput(output: NormalizedToolOutput): ConvertedToolResult {
  switch (output.type) {
    case 'text':
      return { text: output.value, warnings: [] };
    case 'json':
      return { text: safeJsonStringify(output.value), warnings: [] };
    case 'execution-denied':
      return {
        text: output.reason ? `Execution denied: ${output.reason}` : 'Execution denied',
        warnings: [],
      };
    case 'error-text':
      return { text: `Tool error: ${output.value}`, warnings: [] };
    case 'error-json':
      return { text: `Tool error: ${safeJsonStringify(output.value)}`, warnings: [] };
    case 'content': {
      const warnings: ConvertedWarning[] = [];
      const parts = output.value
        .map((part) => {
          if (part.type === 'text') return part.text;
          if (part.type === 'file-data') {
            return `[file-data: ${part.mediaType}${part.filename ? `, ${part.filename}` : ''}]`;
          }
          if (part.type === 'file-url') return `[file-url: ${part.url}]`;
          if (part.type === 'file-id') return '[file-id]';
          if (part.type === 'image-data') return `[image-data: ${part.mediaType}]`;
          if (part.type === 'image-url') return `[image-url: ${part.url}]`;
          if (part.type === 'image-file-id') return '[image-file-id]';

          warnings.push({
            type: 'unsupported',
            feature: `tool-result.content.${String((part as { type?: unknown }).type)}`,
            details: `Unsupported tool content part "${String((part as { type?: unknown }).type)}".`,
          });
          return '[unsupported-tool-content-part]';
        })
        .filter((part) => part.length > 0);

      return { text: parts.join('\n'), warnings };
    }
    default:
      return {
        text: '[unsupported-tool-result-output]',
        warnings: [
          {
            type: 'unsupported',
            feature: `tool-result.output.${String((output as { type?: unknown }).type)}`,
            details: `Unsupported tool result output type "${String((output as { type?: unknown }).type)}".`,
          },
        ],
      };
  }
}

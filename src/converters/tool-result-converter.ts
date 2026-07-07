import type { ConvertedToolResult, ConvertedWarning, NormalizedToolOutput } from './types.js';
import { isImageMediaType } from './image-converter.js';

export function safeJsonStringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

/**
 * Describe the `type` tag of a runtime value that fell outside the static
 * union (used for warnings about unrecognized parts).
 */
function describeTypeTag(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'type' in value) {
    return String(value.type);
  }
  return 'unknown';
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

          if (part.type === 'file') {
            const prefix = isImageMediaType(part.mediaType) ? 'image' : 'file';
            const data = part.data;
            if (data.type === 'data') {
              return prefix === 'image'
                ? `[image-data: ${part.mediaType}]`
                : `[file-data: ${part.mediaType}${part.filename ? `, ${part.filename}` : ''}]`;
            }
            if (data.type === 'url') return `[${prefix}-url: ${data.url}]`;
            if (data.type === 'reference') {
              return prefix === 'image' ? '[image-file-id]' : '[file-id]';
            }
            if (data.type === 'text') return data.text;

            warnings.push({
              type: 'unsupported',
              feature: 'tool-result.content.file',
              details: `Unsupported tool file content data type "${describeTypeTag(data)}".`,
            });
            return '[unsupported-tool-content-part]';
          }

          if (part.type === 'custom') {
            warnings.push({
              type: 'unsupported',
              feature: 'tool-result.content.custom',
              details: 'Custom tool content parts are not supported.',
            });
            return '';
          }

          warnings.push({
            type: 'unsupported',
            feature: `tool-result.content.${describeTypeTag(part)}`,
            details: `Unsupported tool content part "${describeTypeTag(part)}".`,
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
            feature: `tool-result.output.${describeTypeTag(output)}`,
            details: `Unsupported tool result output type "${describeTypeTag(output)}".`,
          },
        ],
      };
  }
}

import type {
  PromptContentPart,
  PromptConversionMode,
  PromptMessage,
  ConvertedPrompt,
  ConvertedWarning,
} from './types.js';
import { formatToolResultOutput, safeJsonStringify } from './tool-result-converter.js';
import { isCompatImagePart, isFilePart, toImageReference } from './image-converter.js';

function isTextPart(part: PromptContentPart): part is { type: 'text'; text: string } {
  return part.type === 'text' && typeof (part as { text?: unknown }).text === 'string';
}

function isReasoningPart(part: PromptContentPart): part is { type: 'reasoning'; text: string } {
  return part.type === 'reasoning' && typeof (part as { text?: unknown }).text === 'string';
}

function isToolCallPart(
  part: PromptContentPart,
): part is { type: 'tool-call'; toolName: string; toolCallId: string; input: unknown } {
  const typed = part as { toolName?: unknown; toolCallId?: unknown; input?: unknown };
  return (
    part.type === 'tool-call' &&
    typeof typed.toolName === 'string' &&
    typeof typed.toolCallId === 'string' &&
    'input' in typed
  );
}

function isToolResultPart(
  part: PromptContentPart,
): part is { type: 'tool-result'; toolName: string; output: unknown } {
  const typed = part as { toolName?: unknown; output?: unknown };
  return (
    part.type === 'tool-result' && typeof typed.toolName === 'string' && typed.output !== undefined
  );
}

function isToolApprovalResponsePart(part: PromptContentPart): part is {
  type: 'tool-approval-response';
  approvalId: string;
  approved: boolean;
  reason?: string;
} {
  const typed = part as { approvalId?: unknown; approved?: unknown; reason?: unknown };
  return (
    part.type === 'tool-approval-response' &&
    typeof typed.approvalId === 'string' &&
    typeof typed.approved === 'boolean' &&
    (typed.reason === undefined || typeof typed.reason === 'string')
  );
}

function collectSystemInstruction(prompt: readonly PromptMessage[]): string | undefined {
  const parts: string[] = [];

  for (const message of prompt) {
    if (message.role !== 'system') continue;

    if (typeof message.content === 'string') {
      const text = message.content.trim();
      if (text.length > 0) parts.push(text);
      continue;
    }

    for (const part of message.content) {
      if (!isTextPart(part)) continue;
      const text = part.text.trim();
      if (text.length > 0) parts.push(text);
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join('\n\n');
}

function normalizeUserInputFromMessages(messages: PromptMessage[]): {
  text: string;
  localImages: ConvertedPrompt['localImages'];
  remoteImageUrls: string[];
  warnings: ConvertedWarning[];
  sawImages: boolean;
} {
  const warnings: ConvertedWarning[] = [];
  const localImages: ConvertedPrompt['localImages'] = [];
  const remoteImageUrls: string[] = [];
  const userTextParts: string[] = [];
  let sawImages = false;

  for (const message of messages) {
    if (message.role !== 'user') continue;

    if (typeof message.content === 'string') {
      const text = message.content.trim();
      if (text.length > 0) userTextParts.push(text);
      continue;
    }

    const inlineTextParts: string[] = [];

    for (const part of message.content) {
      if (isTextPart(part)) {
        const text = part.text.trim();
        if (text.length > 0) inlineTextParts.push(text);
        continue;
      }

      if (isFilePart(part) || isCompatImagePart(part)) {
        const image = toImageReference(part);
        if (!image) continue;

        sawImages = true;
        if (image.kind === 'local') {
          localImages.push(image.image);
        } else if (image.kind === 'remote') {
          remoteImageUrls.push(image.url);
        } else {
          warnings.push({
            type: 'unsupported',
            feature: `prompt.user.${part.type}`,
            details: image.warning,
          });
        }
        continue;
      }

      warnings.push({
        type: 'unsupported',
        feature: `prompt.user.${part.type}`,
        details: `Unsupported user content part "${part.type}".`,
      });
    }

    const joined = inlineTextParts.join('\n').trim();
    if (joined.length > 0) {
      userTextParts.push(joined);
    }
  }

  return {
    text: userTextParts.join('\n').trim(),
    localImages,
    remoteImageUrls,
    warnings,
    sawImages,
  };
}

function formatAssistantParts(parts: PromptContentPart[]): {
  lines: string[];
  warnings: ConvertedWarning[];
} {
  const warnings: ConvertedWarning[] = [];
  const lines: string[] = [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (isTextPart(part)) {
      const text = part.text.trim();
      if (text.length > 0) textParts.push(text);
      continue;
    }

    if (isReasoningPart(part)) {
      const text = part.text.trim();
      if (text.length > 0) {
        lines.push(`Assistant Reasoning: ${text}`);
      }
      continue;
    }

    if (part.type === 'tool-call') {
      if (isToolCallPart(part)) {
        lines.push(`Tool Call (${part.toolName}): ${safeJsonStringify(part.input)}`);
      } else {
        warnings.push({
          type: 'unsupported',
          feature: 'prompt.assistant.tool-call.malformed',
          details: 'Malformed assistant tool-call part; expected toolName, toolCallId, and input.',
        });
      }
      continue;
    }

    if (isToolResultPart(part)) {
      const formatted = formatToolResultOutput(
        part.output as Parameters<typeof formatToolResultOutput>[0],
      );
      lines.push(`Tool Result (${part.toolName}): ${formatted.text}`);
      warnings.push(...formatted.warnings);
      continue;
    }

    if (isFilePart(part)) {
      lines.push(`[assistant-file: ${part.mediaType}]`);
      continue;
    }

    warnings.push({
      type: 'unsupported',
      feature: `prompt.assistant.${part.type}`,
      details: `Unsupported assistant content part "${part.type}".`,
    });
  }

  const text = textParts.join('\n').trim();
  if (text.length > 0) {
    lines.unshift(`Assistant: ${text}`);
  }

  return { lines, warnings };
}

function formatToolRoleParts(parts: PromptContentPart[]): {
  lines: string[];
  warnings: ConvertedWarning[];
} {
  const warnings: ConvertedWarning[] = [];
  const lines: string[] = [];

  for (const part of parts) {
    if (isToolResultPart(part)) {
      const formatted = formatToolResultOutput(
        part.output as Parameters<typeof formatToolResultOutput>[0],
      );
      lines.push(`Tool Result (${part.toolName}): ${formatted.text}`);
      warnings.push(...formatted.warnings);
      continue;
    }

    if (isToolApprovalResponsePart(part)) {
      const decision = part.approved ? 'approved' : 'denied';
      const reason = part.reason ? ` (${part.reason})` : '';
      lines.push(`Tool Approval (${part.approvalId}): ${decision}${reason}`);
      continue;
    }

    warnings.push({
      type: 'unsupported',
      feature: `prompt.tool.${part.type}`,
      details: `Unsupported tool message content part "${part.type}".`,
    });
  }

  return { lines, warnings };
}

function formatStatelessTranscript(
  prompt: readonly PromptMessage[],
  options?: { includeRemoteImagesInMarkers?: boolean },
): {
  text: string;
  localImages: ConvertedPrompt['localImages'];
  remoteImageUrls: string[];
  warnings: ConvertedWarning[];
} {
  const warnings: ConvertedWarning[] = [];
  const lines: string[] = [];
  const localImages: ConvertedPrompt['localImages'] = [];
  const remoteImageUrls: string[] = [];
  const includeRemoteImagesInMarkers = options?.includeRemoteImagesInMarkers ?? true;

  for (const message of prompt) {
    if (message.role === 'system') continue;

    if (message.role === 'user') {
      const normalized = normalizeUserInputFromMessages([message]);
      warnings.push(...normalized.warnings);
      localImages.push(...normalized.localImages);
      remoteImageUrls.push(...normalized.remoteImageUrls);

      const markerImageCount =
        normalized.localImages.length +
        (includeRemoteImagesInMarkers ? normalized.remoteImageUrls.length : 0);
      const marker =
        normalized.sawImages && markerImageCount > 0
          ? `[${markerImageCount} image${markerImageCount === 1 ? '' : 's'} attached]`
          : '';

      const text = [normalized.text, marker]
        .filter((part) => part.length > 0)
        .join('\n')
        .trim();
      if (text.length > 0) {
        lines.push(`User: ${text}`);
      }
      continue;
    }

    if (message.role === 'assistant') {
      const content = Array.isArray(message.content)
        ? (message.content as PromptContentPart[])
        : [{ type: 'text', text: String(message.content) }];
      const formatted = formatAssistantParts(content);
      lines.push(...formatted.lines);
      warnings.push(...formatted.warnings);
      continue;
    }

    if (message.role === 'tool') {
      const content = Array.isArray(message.content)
        ? (message.content as PromptContentPart[])
        : [{ type: 'text', text: String(message.content) }];
      const formatted = formatToolRoleParts(content);
      lines.push(...formatted.lines);
      warnings.push(...formatted.warnings);
      continue;
    }
  }

  return {
    text: lines.join('\n\n').trim(),
    localImages,
    remoteImageUrls,
    warnings,
  };
}

function selectLatestUserTurn(prompt: readonly PromptMessage[]): PromptMessage[] {
  const selected: PromptMessage[] = [];

  let collecting = false;
  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (!message) continue;

    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'user') {
      selected.push(message);
      collecting = true;
      continue;
    }

    if (collecting) {
      break;
    }
  }

  if (selected.length > 0) {
    return selected.reverse();
  }

  for (let i = prompt.length - 1; i >= 0; i -= 1) {
    const message = prompt[i];
    if (!message) continue;
    if (message.role === 'user') {
      return [message];
    }
  }

  return [];
}

function formatPersistentInput(prompt: readonly PromptMessage[]): {
  text: string;
  localImages: ConvertedPrompt['localImages'];
  remoteImageUrls: string[];
  warnings: ConvertedWarning[];
} {
  const selectedUserTurn = selectLatestUserTurn(prompt);
  const normalized = normalizeUserInputFromMessages(selectedUserTurn);

  const nonSystemCount = prompt.filter((message) => message.role !== 'system').length;
  const selectedCount = selectedUserTurn.length;
  const warnings = [...normalized.warnings];

  if (nonSystemCount > selectedCount) {
    warnings.push({
      type: 'other',
      message: 'Stateful mode ignores earlier prompt messages and only sends the latest user turn.',
    });
  }

  return {
    text: normalized.text,
    localImages: normalized.localImages,
    remoteImageUrls: normalized.remoteImageUrls,
    warnings,
  };
}

export function convertPromptToCodexInput(args: {
  prompt: readonly PromptMessage[];
  mode: PromptConversionMode;
  includeRemoteImagesInMarkers?: boolean;
}): ConvertedPrompt {
  const systemInstruction = collectSystemInstruction(args.prompt);

  const converted =
    args.mode === 'persistent'
      ? formatPersistentInput(args.prompt)
      : formatStatelessTranscript(args.prompt, {
          includeRemoteImagesInMarkers: args.includeRemoteImagesInMarkers,
        });

  return {
    systemInstruction,
    text: converted.text,
    localImages: converted.localImages,
    remoteImageUrls: converted.remoteImageUrls,
    warnings: converted.warnings,
  };
}

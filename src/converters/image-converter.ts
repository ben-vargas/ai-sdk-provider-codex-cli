import type { LanguageModelV3FilePart } from '@ai-sdk/provider';
import { extractImageData, type ImageData } from '../image-utils.js';
import type { CompatImagePart, PromptContentPart } from './types.js';

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function isFileUrlValue(value: unknown): boolean {
  if (value instanceof URL) {
    return value.protocol === 'file:';
  }
  if (typeof value === 'string') {
    return /^file:\/\//i.test(value.trim());
  }
  return false;
}

function asRemoteUrl(value: unknown): string | undefined {
  if (value instanceof URL) {
    const asString = value.toString();
    return isHttpUrl(asString) ? asString : undefined;
  }

  if (typeof value === 'string') {
    return isHttpUrl(value) ? value.trim() : undefined;
  }

  return undefined;
}

export function isImageMediaType(mediaType: string): boolean {
  return mediaType.toLowerCase().startsWith('image/');
}

export function isFilePart(part: PromptContentPart): part is LanguageModelV3FilePart {
  return part.type === 'file' && typeof (part as { mediaType?: unknown }).mediaType === 'string';
}

export function isCompatImagePart(part: PromptContentPart): part is CompatImagePart {
  return part.type === 'image';
}

export function toImageReference(
  part: PromptContentPart,
):
  | { kind: 'local'; image: ImageData }
  | { kind: 'remote'; url: string }
  | { kind: 'unsupported'; warning: string }
  | undefined {
  if (isFilePart(part)) {
    if (!isImageMediaType(part.mediaType)) {
      return {
        kind: 'unsupported',
        warning: `Unsupported file mediaType "${part.mediaType}"; only image/* is supported.`,
      };
    }

    const remote = asRemoteUrl(part.data);
    if (remote) {
      return { kind: 'remote', url: remote };
    }

    const image = extractImageData(part);
    if (image) {
      return { kind: 'local', image };
    }

    if (isFileUrlValue(part.data) || isFileUrlValue((part as { url?: unknown }).url)) {
      return {
        kind: 'unsupported',
        warning: 'file:// image URLs are not supported.',
      };
    }

    return {
      kind: 'unsupported',
      warning: 'Unsupported image format in message.',
    };
  }

  if (isCompatImagePart(part)) {
    const remote = asRemoteUrl(part.image) ?? asRemoteUrl(part.url);
    if (remote) {
      return { kind: 'remote', url: remote };
    }

    const image = extractImageData(part);
    if (image) {
      return { kind: 'local', image };
    }

    if (
      isFileUrlValue(part.image) ||
      isFileUrlValue(part.url) ||
      isFileUrlValue((part as { data?: unknown }).data)
    ) {
      return {
        kind: 'unsupported',
        warning: 'file:// image URLs are not supported.',
      };
    }

    return {
      kind: 'unsupported',
      warning: 'Unsupported image format in message.',
    };
  }

  return undefined;
}

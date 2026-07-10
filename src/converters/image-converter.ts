import type { LanguageModelV4FilePart, SharedV4FileData } from '@ai-sdk/provider';
import { getTopLevelMediaType } from '@ai-sdk/provider-utils';
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
  return getTopLevelMediaType(mediaType).toLowerCase() === 'image';
}

export function isFilePart(part: PromptContentPart): part is LanguageModelV4FilePart {
  return part.type === 'file' && 'mediaType' in part && typeof part.mediaType === 'string';
}

export function isCompatImagePart(part: PromptContentPart): part is CompatImagePart {
  return part.type === 'image';
}

/**
 * Narrow a value to the v4 tagged file-data union
 * ({ type: 'data' | 'url' | 'reference' | 'text', ... }).
 */
function isTaggedFileData(value: unknown): value is SharedV4FileData {
  if (typeof value !== 'object' || value === null || !('type' in value)) return false;
  return (
    value.type === 'data' ||
    value.type === 'url' ||
    value.type === 'reference' ||
    value.type === 'text'
  );
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

    const data: unknown = part.data;

    if (isTaggedFileData(data)) {
      if (data.type === 'reference') {
        return {
          kind: 'unsupported',
          warning: 'File reference data is not supported for images.',
        };
      }

      if (data.type === 'text') {
        return {
          kind: 'unsupported',
          warning: 'Inline text file data is not supported for images.',
        };
      }

      if (data.type === 'url') {
        const remote = asRemoteUrl(data.url);
        if (remote) {
          return { kind: 'remote', url: remote };
        }

        if (isFileUrlValue(data.url)) {
          return {
            kind: 'unsupported',
            warning: 'file:// image URLs are not supported.',
          };
        }
      }

      // 'data' variants and data: URLs are extracted to local images.
      const image = extractImageData(part);
      if (image) {
        return { kind: 'local', image };
      }

      return {
        kind: 'unsupported',
        warning: 'Unsupported image format in message.',
      };
    }

    // Legacy untagged data (compat with user-facing message shapes).
    const remote = asRemoteUrl(data);
    if (remote) {
      return { kind: 'remote', url: remote };
    }

    const image = extractImageData(part);
    if (image) {
      return { kind: 'local', image };
    }

    if (isFileUrlValue(data) || ('url' in part && isFileUrlValue(part.url))) {
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

    if (isFileUrlValue(part.image) || isFileUrlValue(part.url) || isFileUrlValue(part.data)) {
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

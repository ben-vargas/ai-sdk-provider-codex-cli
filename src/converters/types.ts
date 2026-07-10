import type {
  LanguageModelV4FilePart,
  LanguageModelV4Message,
  LanguageModelV4ToolApprovalResponsePart,
  LanguageModelV4ToolCallPart,
  LanguageModelV4ToolResultOutput,
  LanguageModelV4ToolResultPart,
  SharedV4FileData,
} from '@ai-sdk/provider';
import type { ImageData } from '../image-utils.js';

export type PromptConversionMode = 'stateless' | 'persistent';

export interface CompatImagePart {
  type: 'image';
  image?: string | URL | Buffer | ArrayBuffer | Uint8Array;
  mimeType?: string;
  data?: string;
  url?: string;
}

export type PromptContentPart =
  | { type: 'text'; text: string }
  | LanguageModelV4FilePart
  | CompatImagePart
  | { type: 'reasoning'; text: string }
  | LanguageModelV4ToolCallPart
  | LanguageModelV4ToolResultPart
  | LanguageModelV4ToolApprovalResponsePart
  | { type: string; [key: string]: unknown };

export type PromptMessage = Omit<LanguageModelV4Message, 'content'> & {
  content: string | PromptContentPart[];
};

export type ConvertedWarning =
  | {
      type: 'unsupported';
      feature: string;
      details: string;
    }
  | {
      type: 'other';
      message: string;
    };

export interface ConvertedPrompt {
  systemInstruction?: string;
  text: string;
  localImages: ImageData[];
  remoteImageUrls: string[];
  warnings: ConvertedWarning[];
}

export interface ConvertedToolResult {
  text: string;
  warnings: ConvertedWarning[];
}

export type NormalizedToolOutput = LanguageModelV4ToolResultOutput;

export type FileData = SharedV4FileData;

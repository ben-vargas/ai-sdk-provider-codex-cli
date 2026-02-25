import type {
  LanguageModelV3DataContent,
  LanguageModelV3FilePart,
  LanguageModelV3Message,
  LanguageModelV3ToolApprovalResponsePart,
  LanguageModelV3ToolCallPart,
  LanguageModelV3ToolResultOutput,
  LanguageModelV3ToolResultPart,
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
  | LanguageModelV3FilePart
  | CompatImagePart
  | { type: 'reasoning'; text: string }
  | LanguageModelV3ToolCallPart
  | LanguageModelV3ToolResultPart
  | LanguageModelV3ToolApprovalResponsePart
  | { type: string; [key: string]: unknown };

export type PromptMessage = Omit<LanguageModelV3Message, 'content'> & {
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

export type NormalizedToolOutput = LanguageModelV3ToolResultOutput;

export type FileData = LanguageModelV3DataContent;

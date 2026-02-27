import { generateId } from '@ai-sdk/provider-utils';
import type { AppServerStreamEmitter } from './emitter.js';

export interface ServerRequestHandlerContext {
  emitter: AppServerStreamEmitter;
  isSameTurn: (params: Record<string, unknown>) => boolean;
}

export type ServerRequestHandler = (params: Record<string, unknown>) => void;

export function createServerRequestHandlers(
  context: ServerRequestHandlerContext,
): Record<string, ServerRequestHandler> {
  return {
    'item/commandExecution/requestApproval': (params) => {
      if (!context.isSameTurn(params)) return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      context.emitter.emitApprovalRequest(itemId);
    },
    'item/fileChange/requestApproval': (params) => {
      if (!context.isSameTurn(params)) return;
      const itemId = typeof params.itemId === 'string' ? params.itemId : generateId();
      context.emitter.emitApprovalRequest(itemId);
    },
  };
}

import type { TurnStartParams, UserInput } from './protocol/types.js';
import type {
  AppServerUserInput,
  CodexAppServerRequestHandlers,
  CodexAppServerSession,
} from './types.js';
import { AppServerRpcClient } from './rpc/client.js';

function toProtocolInput(input: AppServerUserInput): UserInput {
  switch (input.type) {
    case 'text':
      return { type: 'text', text: input.text, text_elements: [] };
    case 'image':
      return { type: 'image', url: input.imageUrl, imageUrl: input.imageUrl };
    case 'localImage':
      return { type: 'localImage', path: input.path };
    default: {
      const neverInput: never = input;
      throw new Error(`Unsupported input type: ${String(neverInput)}`);
    }
  }
}

export interface AppServerSessionOptions {
  threadId: string;
  modelId: string;
  client: AppServerRpcClient;
  defaultTurnParams?: Omit<TurnStartParams, 'threadId' | 'input' | 'model'>;
  requestHandlers?: Partial<CodexAppServerRequestHandlers>;
  autoApprove?: boolean;
}

export class AppServerSession implements CodexAppServerSession {
  readonly threadId: string;
  private readonly modelId: string;
  private readonly client: AppServerRpcClient;
  private readonly defaultTurnParams: Omit<TurnStartParams, 'threadId' | 'input' | 'model'>;
  private readonly requestHandlers: Partial<CodexAppServerRequestHandlers>;
  private readonly autoApprove?: boolean;

  private currentTurnId: string | null = null;
  private active = false;

  constructor(options: AppServerSessionOptions) {
    this.threadId = options.threadId;
    this.modelId = options.modelId;
    this.client = options.client;
    this.defaultTurnParams = options.defaultTurnParams ?? {};
    this.requestHandlers = options.requestHandlers ?? {};
    this.autoApprove = options.autoApprove;
  }

  get turnId(): string | null {
    return this.currentTurnId;
  }

  isActive(): boolean {
    return this.active;
  }

  setTurnId(turnId: string): void {
    this.currentTurnId = turnId;
    this.active = true;
  }

  setInactive(completedTurnId?: string): void {
    if (completedTurnId && this.currentTurnId && completedTurnId !== this.currentTurnId) {
      return;
    }
    this.active = false;
  }

  async injectMessage(content: string | AppServerUserInput[]): Promise<void> {
    const inputs: AppServerUserInput[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content;

    if (inputs.length === 0) {
      return;
    }

    const protocolInputs = inputs.map(toProtocolInput);
    const result = await this.client.withThreadLock(this.threadId, async () => {
      const contextId = this.client.registerRequestContext(this.threadId, {
        handlers: this.requestHandlers,
        autoApprove: this.autoApprove,
      });

      try {
        const turnStartResult = await this.client.turnStart({
          threadId: this.threadId,
          input: protocolInputs,
          model: this.modelId,
          ...this.defaultTurnParams,
        });
        this.client.bindRequestContext(contextId, String(turnStartResult.turn.id));
        return turnStartResult;
      } catch (error) {
        this.client.clearRequestContext(contextId);
        throw error;
      }
    });

    const nextTurnId = String(result.turn.id);
    const alreadyCompleted = this.client.hasTurnCompleted(nextTurnId);

    this.currentTurnId = nextTurnId;
    this.active = !alreadyCompleted;
  }

  async interrupt(): Promise<void> {
    if (!this.active || !this.currentTurnId) {
      return;
    }

    const interruptedTurnId = this.currentTurnId;
    await this.client.turnInterrupt({
      threadId: this.threadId,
      turnId: interruptedTurnId,
    });
    if (this.currentTurnId === interruptedTurnId) {
      this.active = false;
    }
  }
}

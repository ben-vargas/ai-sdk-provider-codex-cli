import type { TurnStartParams, UserInput } from './protocol/types.js';
import type { AppServerUserInput, CodexAppServerSession } from './types.js';
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
}

export class AppServerSession implements CodexAppServerSession {
  readonly threadId: string;
  private readonly modelId: string;
  private readonly client: AppServerRpcClient;
  private readonly defaultTurnParams: Omit<TurnStartParams, 'threadId' | 'input' | 'model'>;

  private currentTurnId: string | null = null;
  private active = false;

  constructor(options: AppServerSessionOptions) {
    this.threadId = options.threadId;
    this.modelId = options.modelId;
    this.client = options.client;
    this.defaultTurnParams = options.defaultTurnParams ?? {};
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

  setInactive(): void {
    this.active = false;
  }

  async injectMessage(content: string | AppServerUserInput[]): Promise<void> {
    const inputs: AppServerUserInput[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content;

    if (inputs.length === 0) {
      return;
    }

    const protocolInputs = inputs.map(toProtocolInput);

    const result = await this.client.turnStart({
      threadId: this.threadId,
      input: protocolInputs,
      model: this.modelId,
      ...this.defaultTurnParams,
    });

    const nextTurnId = String(result.turn.id);
    if (nextTurnId !== this.currentTurnId) {
      this.currentTurnId = nextTurnId;
      this.active = true;
    }
  }

  async interrupt(): Promise<void> {
    if (!this.active || !this.currentTurnId) {
      return;
    }

    await this.client.turnInterrupt({
      threadId: this.threadId,
      turnId: this.currentTurnId,
    });
    this.active = false;
  }
}

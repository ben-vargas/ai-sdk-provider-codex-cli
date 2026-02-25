export type ToolStatsType = 'exec' | 'patch' | 'mcp' | 'web_search' | 'other';

export interface ToolDescriptor {
  toolName: string;
  dynamic?: boolean;
}

export interface ToolExecutionStats {
  totalCalls: number;
  totalDurationMs: number;
  byType: Record<ToolStatsType, number>;
}

export class ToolTracker {
  private readonly activeToolNames = new Map<string, ToolDescriptor>();
  private readonly activeToolStarts = new Map<string, number>();
  private readonly stats: ToolExecutionStats = {
    totalCalls: 0,
    totalDurationMs: 0,
    byType: {
      exec: 0,
      patch: 0,
      mcp: 0,
      web_search: 0,
      other: 0,
    },
  };

  start(toolCallId: string, tool: ToolDescriptor): void {
    this.activeToolNames.set(toolCallId, tool);
    this.activeToolStarts.set(toolCallId, Date.now());
  }

  get(toolCallId: string): ToolDescriptor | undefined {
    return this.activeToolNames.get(toolCallId);
  }

  resolve(toolCallId: string, fallback: ToolDescriptor): ToolDescriptor {
    return this.activeToolNames.get(toolCallId) ?? fallback;
  }

  complete(toolCallId: string, fallback: ToolDescriptor, durationMs?: number): ToolDescriptor {
    const resolved = this.resolve(toolCallId, fallback);
    const startedAt = this.activeToolStarts.get(toolCallId);
    const fallbackDurationMs =
      startedAt !== undefined ? Math.max(0, Date.now() - startedAt) : undefined;
    this.recordCompletion(resolved.toolName, durationMs ?? fallbackDurationMs);
    this.activeToolNames.delete(toolCallId);
    this.activeToolStarts.delete(toolCallId);
    return resolved;
  }

  getStats(): ToolExecutionStats {
    return {
      totalCalls: this.stats.totalCalls,
      totalDurationMs: this.stats.totalDurationMs,
      byType: { ...this.stats.byType },
    };
  }

  private toolTypeFromName(toolName: string): ToolStatsType {
    if (toolName === 'exec') return 'exec';
    if (toolName === 'patch') return 'patch';
    if (toolName === 'web_search') return 'web_search';
    if (toolName.startsWith('mcp__')) return 'mcp';
    return 'other';
  }

  private recordCompletion(toolName: string, durationMs?: number): void {
    this.stats.totalCalls += 1;
    this.stats.byType[this.toolTypeFromName(toolName)] += 1;
    if (typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0) {
      this.stats.totalDurationMs += durationMs;
    }
  }
}

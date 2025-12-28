import { streamText } from 'ai';
import { codexCli } from '../dist/index.js';

const model = codexCli('gpt-5.1-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  dangerouslyBypassApprovalsAndSandbox: true,
  color: 'never',
});

console.log('🔧 Codex CLI Tool Streaming Demo');
console.log('Prompt: "List the current directory with file sizes and summarize"\n');

try {
  const result = await streamText({
    model,
    prompt:
      'List the files in the current directory along with their sizes. Print the command output and include a short summary in your final response.',
  });

  const textBuffer = [];

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'response-metadata': {
        const sessionId = part.providerMetadata?.['codex-cli']?.sessionId;
        if (sessionId) {
          console.log(`📎 Session: ${sessionId}`);
        }
        break;
      }
      case 'tool-input-start':
        console.log(`➡️  Tool input start: ${part.toolName} (${part.id})`);
        break;
      case 'tool-input-delta': {
        const raw = typeof part.delta === 'string' ? part.delta : JSON.stringify(part.delta);
        const preview = (() => {
          try {
            return JSON.stringify(JSON.parse(raw), null, 2);
          } catch {
            return raw;
          }
        })();
        console.log(`📝 Tool input:\n${preview}`);
        break;
      }
      case 'tool-input-end':
        console.log(`⏹️  Tool input end: ${part.id}`);
        break;
      case 'tool-call':
        console.log(`🚀 Executing tool: ${part.toolName} (${part.toolCallId})`);
        break;
      case 'tool-result': {
        const result = part.result;

        if (result && typeof result === 'object' && result.type === 'output-delta') {
          const streamLabel = result.stream ?? 'stdout';
          if (typeof result.output === 'string' && result.output.length > 0) {
            console.log(`📤 ${streamLabel}:\n${result.output}`);
          }
          break;
        }

        const payload = result ?? part.providerMetadata?.['codex-cli'];
        if (payload) {
          console.log(`✅ Tool result (${part.toolCallId}):\n${JSON.stringify(payload, null, 2)}`);
        } else {
          console.log(`✅ Tool result (${part.toolCallId}):`);
          console.log(JSON.stringify(part, null, 2));
        }
        break;
      }
      case 'text-delta': {
        // AI SDK fullStream uses .text for text-delta events
        const textDelta = part.text ?? part.delta;
        if (typeof textDelta === 'string') {
          textBuffer.push(textDelta);
          process.stdout.write(textDelta);
        }
        break;
      }
      case 'finish': {
        // AI SDK v6 stable uses nested usage structure with inputTokens.total, outputTokens.total
        const usage = part.totalUsage || part.usage;
        const inputTotal = usage?.inputTokens?.total ?? 0;
        const outputTotal = usage?.outputTokens?.total ?? 0;
        console.log(`\n🏁 Finished (inputTokens=${inputTotal}, outputTokens=${outputTotal})`);
        break;
      }
      default:
        break;
    }
  }

  if (textBuffer.length === 0) {
    console.log('⚠️  No text received from model');
  } else {
    process.stdout.write('\n');
  }
} catch (error) {
  console.error('❌ Demo failed:', error);
  process.exitCode = 1;
}

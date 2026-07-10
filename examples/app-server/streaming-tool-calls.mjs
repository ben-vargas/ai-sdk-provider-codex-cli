import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.144.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.5', {
    approvalPolicy: 'never',
    sandboxPolicy: { type: 'readOnly' },
    configOverrides: {
      web_search: 'disabled',
      'tools.web_search': false,
      'features.web_search_cached': false,
      'features.web_search_request': false,
    },
    developerInstructions:
      'This example is about shell tool streaming. Use only the shell exec tool. Do not use web search.',
  });

  console.log(' Codex App Server Tool Streaming Demo');
  console.log('Prompt: "List the current directory with file sizes and summarize"\n');

  try {
    const result = await streamText({
      model,
      prompt:
        'Use the shell exec tool to list the files in the current directory along with their sizes. Do not use web search. Print the command output and include a short summary in your final response.',
    });

    const textBuffer = [];
    let threadId;

    for await (const part of result.stream) {
      switch (part.type) {
        case 'response-metadata':
          break;
        case 'tool-input-start':
          console.log(`  Tool input start: ${part.toolName} (${part.id})`);
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
          console.log(` Tool input:\n${preview}`);
          break;
        }
        case 'tool-input-end':
          console.log(`  Tool input end: ${part.id}`);
          break;
        case 'tool-call':
          console.log(` Executing tool: ${part.toolName} (${part.toolCallId})`);
          break;
        case 'tool-result': {
          const output = part.output;

          if (output && typeof output === 'object' && output.type === 'output-delta') {
            if (typeof output.delta === 'string' && output.delta.length > 0) {
              console.log(` stdout:\n${output.delta}`);
            }
            break;
          }

          const payload = output ?? part.providerMetadata?.['codex-app-server'];
          if (payload) {
            console.log(` Tool result (${part.toolCallId}):\n${JSON.stringify(payload, null, 2)}`);
          } else {
            console.log(` Tool result (${part.toolCallId}):`);
            console.log(JSON.stringify(part, null, 2));
          }
          break;
        }
        case 'text-delta': {
          // AI SDK stream uses .text for text-delta events
          const textDelta = part.text ?? part.delta;
          if (typeof textDelta === 'string') {
            textBuffer.push(textDelta);
            process.stdout.write(textDelta);
          }
          break;
        }
        case 'finish-step': {
          threadId = part.providerMetadata?.['codex-app-server']?.threadId ?? threadId;
          break;
        }
        case 'finish': {
          // AI SDK v7 usage exposes flat token totals
          const usage = part.totalUsage;
          const inputTotal = usage?.inputTokens ?? 0;
          const outputTotal = usage?.outputTokens ?? 0;
          if (threadId) {
            console.log(`\n Thread: ${threadId}`);
          }
          console.log(`\n Finished (inputTokens=${inputTotal}, outputTokens=${outputTotal})`);
          break;
        }
        default:
          break;
      }
    }

    if (textBuffer.length === 0) {
      console.log('  No text received from model');
    } else {
      process.stdout.write('\n');
    }
  } catch (error) {
    console.error(' Demo failed:', error);
    process.exitCode = 1;
  }
} finally {
  await appServer.close();
}

import { streamText } from 'ai';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const __dirname = dirname(fileURLToPath(import.meta.url));

const appServer = createCodexAppServer({
  defaultSettings: {
    minCodexVersion: '0.130.0',
    idleTimeoutMs: 30000,
    cwd: __dirname,
  },
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
      'This example validates shell tool streaming. You must use only the shell exec tool, and you must call it exactly twice before answering. Do not use web search. A final answer without two exec tool calls is invalid.',
  });

  console.log(' Multiple Tool Calls Demo');
  console.log('Prompt: "Use separate tool calls to list .mjs files, then count the largest one"\n');

  try {
    const result = await streamText({
      model,
      prompt:
        'Use exactly two separate shell exec tool calls and do not use web search. First execute: find . -maxdepth 1 -name "*.mjs" -type f -print. After that result, execute: wc -l ./*.mjs. Do not combine these into one shell command. Finish with a concise summary.',
    });

    const toolCalls = [];
    const textParts = [];

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'response-metadata':
          break;

        case 'tool-call': {
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName,
            input: part.input,
          });
          console.log(` Tool #${toolCalls.length}: ${part.toolName} (${part.toolCallId})`);

          // Show abbreviated input (handle both string and object inputs)
          try {
            const inputData = typeof part.input === 'string' ? JSON.parse(part.input) : part.input;
            const preview =
              inputData.command || inputData.query || JSON.stringify(inputData).substring(0, 100);
            console.log(`   Input: ${preview}`);
          } catch {
            const inputStr =
              typeof part.input === 'string' ? part.input : JSON.stringify(part.input);
            console.log(`   Input: ${inputStr.substring(0, 100)}`);
          }
          break;
        }

        case 'tool-result': {
          const output =
            part.result && typeof part.result === 'object' && part.result.type === 'tool-result'
              ? part.result.output
              : part.result;
          const tool = toolCalls.find((t) => t.id === part.toolCallId);

          if (tool) {
            const toolIndex = toolCalls.indexOf(tool) + 1;

            // Extract and display aggregated output if available
            if (output && typeof output === 'object' && output.type === 'commandExecution') {
              const aggregatedOutput = output.aggregatedOutput;
              const exitCode = output.exitCode;
              const status = output.status;

              if (typeof aggregatedOutput === 'string' && aggregatedOutput.length > 0) {
                // Show abbreviated output for cleaner display
                const lines = aggregatedOutput.split('\n').filter(Boolean);
                const preview =
                  lines.length > 5 ? lines.slice(0, 5).join('\n') + '\n...' : aggregatedOutput;
                console.log(`   Output (${lines.length} lines):`);
                console.log('   ' + preview.replace(/\n/g, '\n   '));
              }

              if (status === 'failed' && exitCode !== 0) {
                console.log(`    Exit code: ${exitCode}`);
              }
            }

            console.log(` Tool #${toolIndex} completed\n`);
          }
          break;
        }

        case 'text-delta': {
          const textDelta = part.text ?? part.delta;
          if (typeof textDelta === 'string') {
            textParts.push(textDelta);
          }
          break;
        }

        case 'finish': {
          // Display final text response
          if (textParts.length > 0) {
            console.log(' Final Response:');
            console.log(''.repeat(60));
            console.log(textParts.join(''));
            console.log(''.repeat(60));
          }

          // Usage stats - AI SDK v6 stable uses nested structure
          const usage = part.totalUsage || part.usage;
          const inputTotal = usage?.inputTokens?.total ?? 0;
          const outputTotal = usage?.outputTokens?.total ?? 0;
          const threadId = part.providerMetadata?.['codex-app-server']?.threadId;
          if (threadId) {
            console.log(`\n Thread: ${threadId}`);
          }
          console.log(
            `\n Finished: ${toolCalls.length} tool calls, ${inputTotal} input tokens, ${outputTotal} output tokens`,
          );
          break;
        }
      }
    }

    // Summary
    console.log('\n Tool Call Summary:');
    toolCalls.forEach((tool, i) => {
      console.log(`   ${i + 1}. ${tool.name} (${tool.id})`);
    });

    if (toolCalls.length < 2) {
      console.error(` Expected at least 2 shell exec tool calls, got ${toolCalls.length}.`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(' Demo failed:', error.message);
    process.exitCode = 1;
  }
} finally {
  await appServer.close();
}

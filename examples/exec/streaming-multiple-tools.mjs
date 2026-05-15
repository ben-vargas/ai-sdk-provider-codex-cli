import { streamText } from 'ai';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codexExec } from 'ai-sdk-provider-codex-cli';

const exampleCwd = dirname(fileURLToPath(import.meta.url));

const model = codexExec('gpt-5.5', {
  allowNpx: true,
  skipGitRepoCheck: true,
  dangerouslyBypassApprovalsAndSandbox: true,
  color: 'never',
  cwd: exampleCwd,
});

console.log(' Multiple Tool Calls Demo');
console.log('Prompt: "List files, then show line count of the largest .mjs file"\n');

try {
  const result = await streamText({
    model,
    prompt:
      'Using shell commands only and without web search, first list all .mjs files in the current directory with their sizes. Then run a separate shell command to count how many lines the largest .mjs file has.',
  });

  const toolCalls = [];
  const textParts = [];

  for await (const part of result.fullStream) {
    switch (part.type) {
      case 'response-metadata': {
        const sessionId = part.providerMetadata?.['codex-cli']?.sessionId;
        if (sessionId) {
          console.log(` Session: ${sessionId}\n`);
        }
        break;
      }

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
          const inputStr = typeof part.input === 'string' ? part.input : JSON.stringify(part.input);
          console.log(`   Input: ${inputStr.substring(0, 100)}`);
        }
        break;
      }

      case 'tool-result': {
        const output = part.output;
        const tool = toolCalls.find((t) => t.id === part.toolCallId);

        if (tool) {
          const toolIndex = toolCalls.indexOf(tool) + 1;

          // Extract and display aggregated output if available
          if (output && typeof output === 'object') {
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

        const usage = part.totalUsage || part.usage;
        const inputTotal =
          typeof usage?.inputTokens === 'number' ? usage.inputTokens : usage?.inputTokens?.total;
        const outputTotal =
          typeof usage?.outputTokens === 'number' ? usage.outputTokens : usage?.outputTokens?.total;
        const usageSummary =
          typeof inputTotal === 'number' || typeof outputTotal === 'number'
            ? `, ${inputTotal ?? 'unknown'} input tokens, ${outputTotal ?? 'unknown'} output tokens`
            : '';
        console.log(`\n Finished: ${toolCalls.length} tool calls${usageSummary}`);
        break;
      }
    }
  }

  // Summary
  console.log('\n Tool Call Summary:');
  toolCalls.forEach((tool, i) => {
    console.log(`   ${i + 1}. ${tool.name} (${tool.id})`);
  });
} catch (error) {
  console.error(' Demo failed:', error.message);
  process.exitCode = 1;
}

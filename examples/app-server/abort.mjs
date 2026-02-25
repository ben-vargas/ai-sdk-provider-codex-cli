import { streamText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const appServer = createCodexAppServer({
  defaultSettings: { minCodexVersion: '0.105.0-alpha.0', idleTimeoutMs: 30000 },
});

try {
  const model = appServer('gpt-5.3-codex', {
    approvalPolicy: 'on-failure',
    sandboxPolicy: { type: 'workspaceWrite' },
  });

  const controller = new AbortController();
  let abortRequested = false;

  const timer = setTimeout(() => {
    abortRequested = true;
    controller.abort();
    console.log('Abort requested.');
  }, 700);

  const result = streamText({
    model,
    prompt:
      'Write a long numbered list of practical coding tips. Keep going until interrupted, one tip per line.',
    abortSignal: controller.signal,
  });

  let preview = '';
  try {
    for await (const delta of result.textStream) {
      preview += delta;
      if (preview.length > 240) {
        break;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw error;
    }
  } finally {
    clearTimeout(timer);
  }

  if (abortRequested || controller.signal.aborted) {
    console.log('Stream aborted as expected.');
  } else {
    console.log('Stream completed before abort timer fired.');
  }

  console.log('Preview:', preview.replace(/\s+/g, ' ').trim().slice(0, 160));
  console.log('Abort example complete.');
} finally {
  await appServer.close();
}

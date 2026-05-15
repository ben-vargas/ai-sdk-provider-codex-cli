/**
 * Test case: Long prompt with code blocks and multiline content.
 *
 * This example verifies large prompt transport without truncation.
 * It is intentionally read-only and expects text-only output.
 *
 * Run: node examples/app-server/long-prompt-test.mjs
 */

import { generateText } from 'ai';
import { createCodexAppServer } from 'ai-sdk-provider-codex-cli';

const FRONTEND_PROMPT = `You are a designer who also writes production code.
You care about spacing, visual hierarchy, and interaction quality.

Mission: produce a polished sign-in page redesign proposal.

Work principles:
1. Complete the requested task exactly.
2. Keep output practical and implementation-ready.
3. Respect existing stack and conventions.
4. Return only final code and short notes.

Design guidelines:
- Use a clear color system and consistent spacing.
- Keep typography intentional and readable.
- Add subtle motion only where it improves clarity.
- Do not introduce external UI libraries.`;

const USER_PROMPT = `Review the following sign-in page component and suggest improvements.
Stack: Next.js + Tailwind CSS.

Current code:
\`\`\`tsx
"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function SignIn() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            Sign in to your account
          </h2>
        </div>
        <div className="mt-8 space-y-6">
          <button
            onClick={() => signIn("linuxdo", { callbackUrl })}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Continue with Linux.do
          </button>
        </div>
      </div>
    </div>
  );
}
\`\`\`

Requirements:
1. Do not redesign the whole component.
2. Prove you received the complete prompt by referencing callbackUrl and Linux.do.
3. Return exactly three concise lines:
   LONG_PROMPT_OK
   callbackUrl + Linux.do
   one Tailwind improvement under 20 words

Return text only. Do not execute commands. Do not write or modify files.`;

async function main() {
  console.log('=== Long Prompt Test ===\n');

  const fullPrompt = `${FRONTEND_PROMPT}\n\nHuman: ${USER_PROMPT}`;
  console.log(`System prompt length: ${FRONTEND_PROMPT.length} chars`);
  console.log(`User prompt length: ${USER_PROMPT.length} chars`);
  console.log(`Total prompt length: ${fullPrompt.length} chars`);
  console.log('Contains code blocks: yes');
  console.log(`Contains newlines: ${(fullPrompt.match(/\n/g) || []).length}`);
  console.log('\n---\n');

  const codex = createCodexAppServer({
    defaultSettings: {
      minCodexVersion: '0.130.0',
      idleTimeoutMs: 30000,
      cwd: process.cwd(),
      approvalPolicy: 'on-failure',
      sandboxPolicy: { type: 'readOnly' },
      verbose: true,
    },
  });

  try {
    console.log('Calling Codex CLI...\n');

    const result = await generateText({
      model: codex('gpt-5.5'),
      system: FRONTEND_PROMPT,
      prompt: USER_PROMPT,
    });

    console.log('\n=== Result ===\n');
    console.log(`Response length: ${result.text.length} chars`);
    console.log(`Response:\n${result.text.trim()}`);

    if (result.text.length < 40) {
      console.log('\nWARNING: Response is suspiciously short.');
      console.log('This may indicate prompt truncation or corruption.');
    }

    const normalizedResponse = result.text.trim().toLowerCase();
    const genericResponses = new Set([
      'ready',
      'i am ready',
      "i'm ready",
      'ready to help',
      'ready when you are',
      'ok',
      'okay',
    ]);
    const isGenericResponse =
      genericResponses.has(normalizedResponse) ||
      (normalizedResponse.length < 120 && /^((i am|i'm)\s+)?ready\b/.test(normalizedResponse));

    const containsTransportProof =
      result.text.includes('LONG_PROMPT_OK') &&
      normalizedResponse.includes('callbackurl') &&
      normalizedResponse.includes('linux.do');

    if (isGenericResponse || result.text.length < 40 || !containsTransportProof) {
      console.log('\nFAILURE: Response did not prove the long prompt was received.');
      process.exitCode = 1;
      return;
    }

    console.log('\nPASS: Long prompt produced meaningful output.');
  } catch (error) {
    console.error('\nError:', error);
    process.exitCode = 1;
  } finally {
    await codex.close();
  }
}

main();

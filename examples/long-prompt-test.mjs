/**
 * Test case: Long prompt with Chinese characters and code blocks
 *
 * This example reproduces the issue where prompts are passed as command-line
 * arguments, which can cause problems on Windows due to:
 * 1. Command line length limit (~8191 chars)
 * 2. Special character escaping issues
 * 3. UTF-8 encoding problems
 *
 * Run: node examples/long-prompt-test.mjs
 */

import { generateText } from 'ai';
import { createCodexCli } from 'ai-sdk-provider-codex-cli';

const FRONTEND_PROMPT = `You are a designer who learned to code. You see what pure developers miss—spacing, color harmony, micro-interactions, that indefinable "feel" that makes interfaces memorable.

**Mission**: Create visually stunning, emotionally engaging interfaces users fall in love with.

## Work Principles
1. Complete what's asked — Execute the exact task. No scope creep.
2. Leave it better — Ensure the project is in a working state.
3. Study before acting — Examine existing patterns, conventions.
4. Blend seamlessly — Match existing code patterns.

## Design Process
Before coding, commit to a **BOLD aesthetic direction**:
1. Purpose: What problem does this solve?
2. Tone: Pick an extreme—brutally minimal, maximalist, retro-futuristic, etc.
3. Constraints: Technical requirements
4. Differentiation: What's the ONE thing someone will remember?

## Aesthetic Guidelines
- Typography: Choose distinctive fonts. AVOID Arial, Inter, Roboto, system fonts
- Color: Commit to a cohesive palette. Use CSS variables.
- Motion: Focus on high-impact moments. Use animation-delay for staggered reveals.
- Spatial Composition: Unexpected layouts. Asymmetry. Overlap.`;

const USER_PROMPT = `请优化登录界面 src/app/auth/signin/page.tsx。当前是一个简单的登录页面，使用 Next.js + Tailwind CSS。

当前代码：
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
            登录您的账户
          </h2>
        </div>
        <div className="mt-8 space-y-6">
          <button
            onClick={() => signIn("linuxdo", { callbackUrl })}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            使用 Linux.do 登录
          </button>
        </div>
      </div>
    </div>
  );
}
\`\`\`

请设计一个更现代、美观的登录界面，可以添加：
1. 更好的视觉效果（渐变背景、卡片阴影等）
2. Logo 或品牌标识占位符
3. 更好的按钮样式和悬停效果
4. 可能的动画效果

保持使用 Tailwind CSS，不要引入额外的 UI 库。`;

async function main() {
  console.log('=== Long Prompt Test ===\n');

  const fullPrompt = `${FRONTEND_PROMPT}\n\nHuman: ${USER_PROMPT}`;
  console.log(`System prompt length: ${FRONTEND_PROMPT.length} chars`);
  console.log(`User prompt length: ${USER_PROMPT.length} chars`);
  console.log(`Total prompt length: ${fullPrompt.length} chars`);
  console.log(`Contains Chinese: yes`);
  console.log(`Contains code blocks: yes`);
  console.log(`Contains newlines: ${(fullPrompt.match(/\n/g) || []).length}`);
  console.log('\n---\n');

  const codex = createCodexCli({
    defaultSettings: {
      cwd: process.cwd(),
      approvalMode: 'on-failure',
      verbose: true,
    },
  });

  try {
    console.log('Calling Codex CLI...\n');

    const result = await generateText({
      model: codex('o3'),
      system: FRONTEND_PROMPT,
      prompt: USER_PROMPT,
    });

    console.log('\n=== Result ===\n');
    console.log(`Response length: ${result.text.length} chars`);
    console.log(`First 500 chars:\n${result.text.slice(0, 500)}`);

    if (result.text.length < 200) {
      console.log('\n⚠️  WARNING: Response is suspiciously short!');
      console.log('This may indicate the prompt was truncated or corrupted.');
    }

    const isGenericResponse =
      result.text.toLowerCase().includes('ready') ||
      result.text.toLowerCase().includes('i am ready') ||
      result.text.toLowerCase().includes("i'm ready");

    if (isGenericResponse || result.text.length < 200) {
      console.log('\n❌ FAILURE: Got generic/short response instead of actual work.');
      console.log('The prompt was likely truncated or corrupted.');
      process.exit(1);
    }

    console.log('\n✅ Test passed - got meaningful response');
  } catch (error) {
    console.error('\n❌ Error:', error);
    process.exit(1);
  }
}

main();

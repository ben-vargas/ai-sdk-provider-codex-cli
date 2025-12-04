/**
 * Image Support Example
 *
 * This example demonstrates how to use multimodal (image) inputs with the
 * Codex CLI provider. Images are passed to Codex CLI via the --image flag.
 *
 * Supported image formats:
 * - Base64 data URL (data:image/png;base64,...)
 * - Base64 string (without data URL prefix)
 * - Buffer / Uint8Array / ArrayBuffer
 *
 * NOT supported:
 * - HTTP/HTTPS URLs (images must be provided as binary data)
 *
 * Usage:
 *   node examples/image-support.mjs                    # Uses bundled bull.webp
 *   node examples/image-support.mjs /path/to/image.png # Uses custom image
 */

import { readFileSync } from 'node:fs';
import { extname, basename, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText, streamText } from 'ai';
import { codexCli } from '../dist/index.js';

// Supported image extensions and their MIME types
const SUPPORTED_EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};

/**
 * Convert an image file to a base64 data URL
 */
function toDataUrl(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mediaType = SUPPORTED_EXTENSIONS[ext];
  if (!mediaType) {
    throw new Error(
      `Unsupported image extension "${ext}". Supported: ${Object.keys(SUPPORTED_EXTENSIONS).join(', ')}`,
    );
  }

  const contents = readFileSync(filePath);
  const base64 = contents.toString('base64');
  return `data:${mediaType};base64,${base64}`;
}

/**
 * Get media type from file path
 */
function getMediaType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS[ext] || 'image/png';
}

// Create model instance - gpt-5.1-codex supports vision/multimodal inputs
const model = codexCli('gpt-5.1-codex', {
  allowNpx: true,
  skipGitRepoCheck: true,
  approvalMode: 'on-failure',
  sandboxMode: 'workspace-write',
  color: 'never',
});

async function main() {
  // Use bundled bull.webp as default if no path provided
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const defaultImagePath = join(__dirname, 'bull.webp');

  const filePath = process.argv[2] || defaultImagePath;
  const fileName = basename(filePath);

  console.log('='.repeat(60));
  console.log('Image Support Example - Codex CLI Provider');
  console.log('='.repeat(60));

  if (!process.argv[2]) {
    console.log(`\nUsing default image: ${fileName}`);
    console.log('Tip: Pass a custom image path as argument:');
    console.log('  node examples/image-support.mjs /path/to/image.png\n');
  } else {
    console.log(`\nUsing custom image: ${fileName}\n`);
  }

  // ===== Example 1: Using generateText with data URL =====
  console.log('-'.repeat(60));
  console.log('Example 1: generateText with data URL');
  console.log('-'.repeat(60));

  const dataUrl = toDataUrl(filePath);
  console.log(`Image loaded: ${fileName} (${(dataUrl.length / 1024).toFixed(1)} KB base64)\n`);

  console.log('Asking model to describe the image...\n');

  const { text } = await generateText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Describe what you see in this image "${fileName}" in 2-3 sentences.`,
          },
          { type: 'image', image: dataUrl },
        ],
      },
    ],
  });

  console.log('Response:', text);

  // ===== Example 2: Using streamText with Buffer =====
  console.log('\n' + '-'.repeat(60));
  console.log('Example 2: streamText with Buffer');
  console.log('-'.repeat(60));

  const imageBuffer = readFileSync(filePath);
  const mediaType = getMediaType(filePath);

  console.log(`\nAsking model about the mood of the image (streaming)...\n`);
  process.stdout.write('Response: ');

  const { textStream } = await streamText({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What mood or emotion does this image convey? Answer in one sentence.',
          },
          {
            type: 'image',
            image: imageBuffer,
            mimeType: mediaType,
          },
        ],
      },
    ],
  });

  for await (const chunk of textStream) {
    process.stdout.write(chunk);
  }
  process.stdout.write('\n');

  // ===== Example 3: Multiple images =====
  console.log('\n' + '-'.repeat(60));
  console.log('Example 3: Demonstrating multiple images support');
  console.log('-'.repeat(60));

  console.log('\nNote: You can pass multiple images in a single message.');
  console.log('Each image becomes a separate --image flag to Codex CLI.\n');

  console.log('Code example:');
  console.log(`
  const { text } = await generateText({
    model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Compare these two images' },
        { type: 'image', image: image1Buffer, mimeType: 'image/png' },
        { type: 'image', image: image2Buffer, mimeType: 'image/jpeg' },
      ],
    }],
  });
`);

  console.log('='.repeat(60));
  console.log('Examples completed successfully!');
  console.log('='.repeat(60));
}

main().catch((error) => {
  console.error('\nError:', error.message);
  if (error.cause) {
    console.error('Cause:', error.cause);
  }
  process.exitCode = 1;
});

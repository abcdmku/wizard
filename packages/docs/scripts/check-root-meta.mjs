#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const docsRoot = resolve(__dirname, '..');
const metaPath = resolve(docsRoot, 'pages/_meta.json');

const expectedRootOrder = [
  'index',
  'getting-started',
  'essentials',
  'react',
  'advanced',
  'api-docs',
  'examples',
];

function main() {
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
  const keys = Object.keys(meta);
  const errors = [];

  if (JSON.stringify(keys) !== JSON.stringify(expectedRootOrder)) {
    errors.push(
      `Root _meta.json key order must be: ${expectedRootOrder.join(', ')}. Found: ${keys.join(', ')}`
    );
  }

  for (const key of keys) {
    const item = meta[key];
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      if (item.type === 'page' || item.type === 'menu') {
        errors.push(`Top-level item "${key}" cannot use type "${item.type}". Use "doc" or plain title.`);
      }
    }
  }

  if (errors.length > 0) {
    console.error('[check-root-meta] Navigation policy violations found:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('[check-root-meta] Root navigation metadata is valid.');
}

main();

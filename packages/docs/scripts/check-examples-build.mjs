#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '../../..');

// In-scope example matrix (DAG demo excluded for now by project policy).
const examplePackages = [
  'basic-form-wizard',
  'advanced-branching',
  '@examples/persistence-local',
  '@examples/router-guard',
  '@examples/zod-validation',
  'react-router-wizard-example',
  'node-saga-wizard-example',
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  return result.status ?? 1;
}

console.log('[docs/check-examples] Starting example build matrix...');

const failures = [];

for (const pkg of examplePackages) {
  console.log(`\n[docs/check-examples] Building: ${pkg}`);
  const status = run('pnpm', ['--filter', pkg, 'build']);
  if (status !== 0) {
    failures.push(pkg);
  }
}

if (failures.length > 0) {
  console.error('\n[docs/check-examples] Failed packages:');
  for (const pkg of failures) {
    console.error(`- ${pkg}`);
  }
  process.exit(1);
}

console.log('\n[docs/check-examples] All in-scope examples built successfully.');

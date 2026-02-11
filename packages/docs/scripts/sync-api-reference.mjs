#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const docsRoot = resolve(__dirname, '..');
const repoRoot = resolve(docsRoot, '..', '..');
const checkMode = process.argv.includes('--check');

const MARKER_START = '{/* AUTO-EXPORTS:START */}';
const MARKER_END = '{/* AUTO-EXPORTS:END */}';

const coreCompatibilityExports = new Set([
  'EnhancedDataMapFromDefs',
  'EnhancedWizard',
  'InferContext',
  'InferDataMap',
  'InferSteps',
  'StepRuntime',
  'WizardConfig',
  'WizardPersistence',
  'WizardTransitionEvent',
]);

const reactCoreReExportTypes = new Set([
  'JSONValue',
  'StepArgs',
  'StepDefinition',
  'StepEnterArgs',
  'StepExitArgs',
  'StepMetaCore',
  'StepStatus',
  'ValOrFn',
  'ValidateArgs',
  'Wizard',
  'WizardState',
  'WizardStep',
]);

const docs = [
  {
    packageName: '@wizard/core',
    entryPath: resolve(repoRoot, 'packages/core/src/index.ts'),
    docPath: resolve(repoRoot, 'packages/docs/pages/api-docs/core.mdx'),
    categoryOrder: ['Runtime', 'Primary types', 'Compatibility aliases'],
  },
  {
    packageName: '@wizard/react',
    entryPath: resolve(repoRoot, 'packages/react/src/index.ts'),
    docPath: resolve(repoRoot, 'packages/docs/pages/api-docs/react.mdx'),
    categoryOrder: [
      'Provider',
      'Hooks',
      'Factory',
      'Router integration',
      'React-specific types',
      'Core re-exports',
      'Types',
      'Runtime',
    ],
  },
];

function hasExportModifier(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

function parseExports(entryPath) {
  const sourceText = readFileSync(entryPath, 'utf8');
  const sourceFile = ts.createSourceFile(
    entryPath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  );

  const exportsByName = new Map();

  const addExport = (name, typeOnly, source) => {
    const existing = exportsByName.get(name);
    if (!existing) {
      exportsByName.set(name, { name, typeOnly, source });
      return;
    }
    exportsByName.set(name, {
      name,
      typeOnly: existing.typeOnly && typeOnly,
      source: existing.source ?? source,
    });
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      const source =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      for (const specifier of statement.exportClause.elements) {
        addExport(specifier.name.text, Boolean(statement.isTypeOnly || specifier.isTypeOnly), source);
      }
      continue;
    }

    if (!hasExportModifier(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      addExport(statement.name.text, false, null);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) addExport(declaration.name.text, false, null);
      }
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      addExport(statement.name.text, false, null);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      addExport(statement.name.text, true, null);
    } else if (ts.isInterfaceDeclaration(statement)) {
      addExport(statement.name.text, true, null);
    }
  }

  return [...exportsByName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function categorizeCoreExport(exp) {
  if (exp.typeOnly && (coreCompatibilityExports.has(exp.name) || exp.name.startsWith('Infer'))) {
    return 'Compatibility aliases';
  }
  if (!exp.typeOnly) return 'Runtime';
  return 'Primary types';
}

function categorizeReactExport(exp) {
  if (!exp.typeOnly && exp.name === 'WizardProvider') return 'Provider';
  if (exp.typeOnly && exp.name === 'WizardProviderProps') return 'Provider';
  if (exp.name.includes('Router') || exp.name === 'useSyncWizardWithRouter') {
    return 'Router integration';
  }
  if (!exp.typeOnly && exp.name.startsWith('use')) return 'Hooks';
  if (!exp.typeOnly && exp.name === 'createReactWizardFactory') return 'Factory';
  if (reactCoreReExportTypes.has(exp.name)) return 'Core re-exports';
  if (
    exp.name.startsWith('React') ||
    exp.name.startsWith('StepComponent') ||
    exp.name === 'StepMetaUI'
  ) {
    return 'React-specific types';
  }
  if (exp.typeOnly) return 'Types';
  return 'Runtime';
}

function sortByCategoryAndName(exportsList, categoryOrder, categorize) {
  const categoryIndex = new Map(categoryOrder.map((c, i) => [c, i]));
  return [...exportsList].sort((a, b) => {
    const ca = categorize(a);
    const cb = categorize(b);
    const ia = categoryIndex.get(ca) ?? Number.MAX_SAFE_INTEGER;
    const ib = categoryIndex.get(cb) ?? Number.MAX_SAFE_INTEGER;
    if (ia !== ib) return ia - ib;
    return a.name.localeCompare(b.name);
  });
}

function buildGeneratedBlock(packageName, exportsList, categoryOrder) {
  const categorize = packageName === '@wizard/core' ? categorizeCoreExport : categorizeReactExport;
  const ordered = sortByCategoryAndName(exportsList, categoryOrder, categorize);

  const lines = [];
  lines.push(MARKER_START);
  lines.push('Generated from package entrypoint exports via `scripts/sync-api-reference.mjs`.');
  lines.push('| Symbol | Kind | Category |');
  lines.push('| --- | --- | --- |');
  for (const exp of ordered) {
    const kind = exp.typeOnly ? 'type' : 'value';
    const category = categorize(exp);
    lines.push(`| \`${exp.name}\` | \`${kind}\` | ${category} |`);
  }
  lines.push(MARKER_END);
  return lines.join('\n');
}

function updateDoc(docConfig) {
  const exportsList = parseExports(docConfig.entryPath);
  const generatedBlock = buildGeneratedBlock(
    docConfig.packageName,
    exportsList,
    docConfig.categoryOrder
  );
  const original = readFileSync(docConfig.docPath, 'utf8');
  const markerPattern = new RegExp(
    `${MARKER_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${MARKER_END.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    )}`
  );

  if (!markerPattern.test(original)) {
    throw new Error(
      `Missing auto-export markers in ${relative(repoRoot, docConfig.docPath)}. Add ${MARKER_START}/${MARKER_END}.`
    );
  }

  const next = original.replace(markerPattern, generatedBlock);
  const changed = next !== original;

  if (!checkMode && changed) {
    writeFileSync(docConfig.docPath, next);
    console.log(`[sync-api-reference] updated ${relative(repoRoot, docConfig.docPath)}`);
  }

  return { changed, path: docConfig.docPath };
}

function main() {
  const results = docs.map(updateDoc);
  const changed = results.filter((r) => r.changed);

  if (checkMode) {
    if (changed.length > 0) {
      console.error('[sync-api-reference] API reference docs are out of sync:');
      for (const item of changed) {
        console.error(`- ${relative(repoRoot, item.path)}`);
      }
      console.error('[sync-api-reference] Run `pnpm --filter @wizard/docs run sync:api-ref`.');
      process.exit(1);
    }
    console.log('[sync-api-reference] API reference docs are in sync.');
    return;
  }

  if (changed.length === 0) {
    console.log('[sync-api-reference] No changes needed.');
  }
}

main();

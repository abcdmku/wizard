#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const docsRoot = resolve(__dirname, '..');
const repoRoot = resolve(docsRoot, '..', '..');

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

  const names = new Set();

  for (const statement of sourceFile.statements) {
    if (
      ts.isExportDeclaration(statement) &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const specifier of statement.exportClause.elements) names.add(specifier.name.text);
      continue;
    }

    if (!hasExportModifier(statement)) continue;

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      names.add(statement.name.text);
    } else if (ts.isTypeAliasDeclaration(statement)) {
      names.add(statement.name.text);
    } else if (ts.isInterfaceDeclaration(statement)) {
      names.add(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    }
  }

  return names;
}

function listDocsFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listDocsFiles(fullPath));
      continue;
    }
    const extension = extname(entry.name);
    if (extension === '.md' || extension === '.mdx') files.push(fullPath);
  }
  return files;
}

function parseNamedImports(content, packageName) {
  const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const importPattern = new RegExp(
    `import\\s+\\{([^}]*)\\}\\s+from\\s+['"]${escapeRegex(packageName)}['"]`,
    'g'
  );
  const imported = [];

  for (const match of content.matchAll(importPattern)) {
    const startIndex = match.index ?? 0;
    const line = content.slice(0, startIndex).split(/\r?\n/).length;
    const specifierBlock = match[1];
    const specifiers = specifierBlock
      .split(',')
      .map((part) => part.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (const specifier of specifiers) {
      const withoutType = specifier.replace(/^type\s+/, '').trim();
      const [name] = withoutType.split(/\s+as\s+/i);
      if (name) imported.push({ name: name.trim(), line });
    }
  }

  return imported;
}

function main() {
  const coreExports = parseExports(resolve(repoRoot, 'packages/core/src/index.ts'));
  const reactExports = parseExports(resolve(repoRoot, 'packages/react/src/index.ts'));

  const targetFiles = [
    resolve(repoRoot, 'README.md'),
    resolve(repoRoot, 'packages/core/README.md'),
    ...listDocsFiles(resolve(repoRoot, 'packages/docs/pages')),
  ];

  const errors = [];

  for (const filePath of targetFiles) {
    const content = readFileSync(filePath, 'utf8');

    const coreImports = parseNamedImports(content, '@wizard/core');
    for (const imp of coreImports) {
      if (!coreExports.has(imp.name)) {
        errors.push(
          `${relative(repoRoot, filePath)}:${imp.line} imports missing @wizard/core symbol \`${imp.name}\``
        );
      }
    }

    const reactImports = parseNamedImports(content, '@wizard/react');
    for (const imp of reactImports) {
      if (!reactExports.has(imp.name)) {
        errors.push(
          `${relative(repoRoot, filePath)}:${imp.line} imports missing @wizard/react symbol \`${imp.name}\``
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('[check-doc-imports] Invalid imports detected:');
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log('[check-doc-imports] All @wizard/core and @wizard/react imports are valid.');
}

main();

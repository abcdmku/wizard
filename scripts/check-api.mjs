#!/usr/bin/env node
/**
 * API snapshot governance — one snapshot per public ENTRY.
 *
 *   node scripts/check-api.mjs            # diff packages/<pkg>/dist/<entry>.d.ts against api/<slug>.d.ts
 *   node scripts/check-api.mjs --update   # overwrite the snapshots
 *
 * Entries come from each package's `exports` (`.` → api/core.d.ts, `./testing` →
 * api/core-testing.d.ts, …). Also fails if a public declaration file contains the `any` type
 * or an `as` assertion. Only guarded fallbacks for invalid authoring calls may use `any`.
 * Requires `pnpm build` to have run.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative } from 'node:path'
import { listPackages, ROOT } from './lib/exports.mjs'

const update = process.argv.includes('--update')
const ts = createRequire(import.meta.url)('typescript')
const apiDir = join(ROOT, 'api')
mkdirSync(apiDir, { recursive: true })

let failed = false

for (const pkg of listPackages()) {
  for (const entry of pkg.entries) {
    const label = entry.specifier
    if (!existsSync(entry.dtsPath)) {
      console.error(
        `[api] ${label}: ${relative(ROOT, entry.dtsPath)} missing — run pnpm build first`,
      )
      failed = true
      continue
    }
    const content = readFileSync(entry.dtsPath, 'utf8').replaceAll('\r\n', '\n')

    // Invalid authoring calls use a few guarded fallback types to avoid cascading errors.
    // Every other explicit `any` remains forbidden, including all adapter declarations.
    const stripped = stripComments(content)
    const anyHits = countUnsafeAny(content, label)
    if (anyHits > 0) {
      console.error(
        `[api] ${label}: ${anyHits} occurrence(s) of 'any' in the public declaration file`,
      )
      failed = true
    }
    const asHits = [...stripped.matchAll(/\)\s+as\s+[A-Za-z_$]/g)].length
    if (asHits > 0) {
      console.error(
        `[api] ${label}: ${asHits} type assertion(s) leaked into the public declaration file`,
      )
      failed = true
    }

    const snapshotPath = join(apiDir, `${entry.slug}.d.ts`)
    if (update) {
      writeFileSync(snapshotPath, content)
      console.log(`[api] wrote ${relative(ROOT, snapshotPath)}`)
      continue
    }
    if (!existsSync(snapshotPath)) {
      console.error(
        `[api] ${label}: no snapshot at ${relative(ROOT, snapshotPath)} — run pnpm check:api:update`,
      )
      failed = true
      continue
    }
    const prev = readFileSync(snapshotPath, 'utf8').replaceAll('\r\n', '\n')
    if (prev !== content) {
      console.error(
        `[api] ${label}: public API changed. Review the diff and run pnpm check:api:update (and add a changeset).`,
      )
      printDiff(prev, content)
      failed = true
    } else {
      console.log(`[api] ${label}: unchanged`)
    }
  }
}

process.exit(failed ? 1 : 0)

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

function countUnsafeAny(content, specifier) {
  const source = ts.createSourceFile('api.d.ts', content, ts.ScriptTarget.Latest, true)
  let count = 0
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.AnyKeyword && !isFailureFallback(node, specifier)) count++
    ts.forEachChild(node, visit)
  }
  visit(source)
  return count
}

function isFailureFallback(node, specifier) {
  if (specifier !== '@openwizard/core') return false
  const parent = node.parent
  if (
    ts.isTypeParameterDeclaration(parent) &&
    parent.default === node &&
    ['R', 'Item'].includes(parent.name.text) &&
    ts.isMethodSignature(parent.parent) &&
    parent.parent.name.getText() === 'step' &&
    ts.isInterfaceDeclaration(parent.parent.parent) &&
    parent.parent.parent.name.text === 'StepApi'
  )
    return true
  let declaration = parent
  while (
    declaration &&
    !ts.isTypeAliasDeclaration(declaration) &&
    !ts.isInterfaceDeclaration(declaration)
  )
    declaration = declaration.parent
  if (!declaration) return false
  if (declaration.name.text === 'NeedOutput')
    return (
      declaration.type === parent &&
      declaration.typeParameters?.[0]?.name.text === 'S' &&
      ts.isConditionalTypeNode(parent) &&
      parent.trueType === node &&
      isNamedType(parent.checkType, 'S') &&
      parent.extendsType.kind === ts.SyntaxKind.StringKeyword
    )
  if (declaration.name.text === 'StepOutput')
    return (
      ts.isConditionalTypeNode(parent) &&
      parent.trueType === node &&
      parent.checkType.getText() === "'waitFor'" &&
      parent.extendsType.getText() === 'Xk' &&
      isEmptyWaitGuard(parent.parent, parent)
    )
  if (declaration.name.text === 'UncheckedSteps')
    return (
      ts.isTypeReferenceNode(parent) &&
      parent.typeName.getText() === 'WizardStep' &&
      parent.typeArguments?.[1] === node
    )
  return false
}

function isEmptyWaitGuard(guard, fallback) {
  if (!ts.isConditionalTypeNode(guard) || guard.trueType !== fallback) return false
  const checked = guard.checkType
  const expected = guard.extendsType
  if (!ts.isTupleTypeNode(checked) || !ts.isTupleTypeNode(expected)) return false
  if (checked.elements.length !== 1 || expected.elements.length !== 1) return false
  const keys = checked.elements[0]
  return (
    ts.isTypeOperatorNode(keys) &&
    keys.operator === ts.SyntaxKind.KeyOfKeyword &&
    isNamedType(keys.type, 'H') &&
    expected.elements[0].kind === ts.SyntaxKind.NeverKeyword
  )
}

function isNamedType(node, name) {
  return (
    ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === name
  )
}

function printDiff(a, b) {
  const al = a.split('\n')
  const bl = b.split('\n')
  const max = Math.max(al.length, bl.length)
  let shown = 0
  for (let i = 0; i < max && shown < 40; i++) {
    if (al[i] !== bl[i]) {
      console.error(`  L${i + 1}\n  - ${al[i] ?? ''}\n  + ${bl[i] ?? ''}`)
      shown++
    }
  }
}

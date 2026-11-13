/**
 * What a compact step card says about a step that has no live status: a kind word (`form`,
 * `wait`, `timer`, `each`, `child`, `route`) and the one fact that tells most, the third line
 * some cards keep while the run is live, and the full account for the card's tooltip.
 *
 * @packageDocumentation
 */

import type { ManifestStep } from '@openwizard/core/inspect'
import { formatMs } from '../layout/model'

/** The kind word a card shows, or `undefined` for a plain step that runs code. */
export function kindWord(step: ManifestStep): string | undefined {
  if (step.kind === 'view') return 'form'
  if (step.kind === 'child') return 'child'
  if (step.waitsFor !== undefined && step.waitsFor.length > 0) return 'wait'
  if (step.sleep !== undefined) return 'timer'
  if (step.each !== undefined) return 'each'
  if (step.dynamicNext === true && !step.hooks.includes('run')) return 'route'
  return undefined
}

/** The one fact a card shows beside its kind word, most telling first. */
export function mainFact(step: ManifestStep): string | undefined {
  if (step.waitsFor !== undefined && step.waitsFor.length > 0) {
    const [first] = step.waitsFor
    return step.waitsFor.length === 1 ? first : `${step.waitsFor.length} events`
  }
  if (step.sleep !== undefined)
    return step.sleep === 'dynamic' ? 'set at start' : formatMs(step.sleep)
  return behaviour(step)[0]
}

/** How many characters of the third line fit on a card. */
const SUB_FITS = 21

/**
 * The card's third line, which stays while the run is live: `each · 2 at a time` for a step
 * that runs per item, and `any of a, b` for a step that starts when any one of them is done.
 */
export function subLine(step: ManifestStep, anyOf: readonly string[]): string | undefined {
  const parts: string[] = []
  if (step.each !== undefined) parts.push(`each · ${step.each.concurrency} at a time`)
  if (anyOf.length > 0) {
    // The names when they fit on the card, else how many; the tooltip names them all.
    const named = `any of ${anyOf.join(', ')}`
    parts.push(named.length <= SUB_FITS ? named : `any of ${anyOf.length} steps`)
  }
  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** Facts that change how a step behaves when it fails or is undone. */
function behaviour(step: ManifestStep): string[] {
  const facts: string[] = []
  if (step.retry !== undefined && step.retry.retries > 0)
    facts.push(`retries ${step.retry.retries}`)
  if (step.timeout !== undefined) facts.push(`timeout ${formatMs(step.timeout)}`)
  if (step.fallback !== undefined) facts.push(`fallback ${step.fallback}`)
  if (step.compensable === true) facts.push('undo')
  return facts
}

/** Every fact about a step, one per line, for the tooltip. */
export function allFacts(step: ManifestStep): string[] {
  const facts: string[] = []
  if (step.waitsFor !== undefined && step.waitsFor.length > 0)
    facts.push(`Waits for ${step.waitsFor.join(' or ')}`)
  if (step.sleep !== undefined)
    facts.push(
      step.sleep === 'dynamic'
        ? 'Sleeps for a time set when it starts'
        : `Sleeps ${formatMs(step.sleep)}`,
    )
  if (step.each !== undefined) facts.push(`Runs once per item, ${step.each.concurrency} at a time`)
  if (step.child !== undefined) facts.push(`Runs the ${step.child.name} wizard`)
  if (step.retry !== undefined && step.retry.retries > 0)
    facts.push(`Retries ${step.retry.retries} times after a failure`)
  if (step.timeout !== undefined) facts.push(`Times out after ${formatMs(step.timeout)}`)
  if (step.fallback !== undefined) facts.push(`Goes to ${step.fallback} when it fails`)
  if (step.compensable === true) facts.push('Has an undo hook')
  return facts
}

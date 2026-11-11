/** Indexed children reuse the ordinary bridge, including tree turns and passive restore. @internal */

import type { CompiledStep } from '../authoring/compiled'
import {
  type EachChildAddress,
  eachChildAddress,
  parseEachChildAddress,
} from '../machine/child-address'
import type { ResultToken } from '../machine/commands'
import { eachItem } from '../machine/each-state'
import type { StepRecord } from '../machine/state'
import { setOwn } from '../machine/util'
import type { Snapshot } from '../wizard/snapshot'
import { createChildBridge } from './child'
import type { ChildBridge, ChildBridgeOptions, ChildHandle } from './child-types'

export {
  type EachChildAddress,
  eachChildAddress,
  parseEachChildAddress,
} from '../machine/child-address'

export function createEachChildBridge<H extends ChildHandle, P = Snapshot>(
  opts: ChildBridgeOptions<H, P>,
): ChildBridge<H, P> {
  const plain = createChildBridge(opts)
  const addresses = new Map<string, EachChildAddress>()
  const byStep = new Map<string, Set<string>>()
  const definitions: Record<string, CompiledStep> = {}

  const register = (address: string, item: EachChildAddress): void => {
    addresses.set(address, item)
    let owned = byStep.get(item.step)
    if (owned === undefined) {
      owned = new Set()
      byStep.set(item.step, owned)
    }
    owned.add(address)
    const definition = opts.def.steps[item.step]
    if (definition !== undefined) setOwn(definitions, address, definition)
  }

  const itemFor = (address: string): EachChildAddress => {
    const item = addresses.get(address)
    if (item === undefined) throw new Error(`unknown indexed child '${address}'`)
    return item
  }

  const tokenFor = (address: string): ResultToken => {
    const { step, index } = itemFor(address)
    const record = opts.getState().steps[step]
    const item = record?.each === undefined ? undefined : eachItem(record.each, index)
    return {
      ...(opts.tokenFor?.(step) ?? { step, runId: record?.runId ?? 0 }),
      itemIndex: index,
      attempt: item?.attempt ?? 0,
      itemGeneration: item?.generation ?? 0,
    }
  }

  const indexed = createChildBridge<H, P>({
    ...opts,
    def: { ...opts.def, steps: definitions },
    tokenFor,
    hookArgs(address, causedBy) {
      const { step, index } = itemFor(address)
      return {
        ...opts.hookArgs(step, causedBy),
        item: opts.getState().steps[step]?.each?.items[index],
        index,
      }
    },
    getState() {
      const state = opts.getState()
      // Read only the addressed record. Copying the growing item table per summary is quadratic.
      const steps = new Proxy(state.steps, {
        get(target, property): StepRecord | undefined {
          if (typeof property !== 'string') return undefined
          const item = addresses.get(property)
          if (item === undefined) return target[property]
          const record = target[item.step]
          if (record === undefined) return undefined
          const child =
            record.each === undefined ? undefined : eachItem(record.each, item.index).child
          const view = { ...record, id: property }
          if (child === undefined) delete view.child
          else view.child = child
          return view
        },
      })
      return { ...state, steps }
    },
    send(message, causedBy) {
      if (message.type !== 'res.child') {
        opts.send(message, causedBy)
        return
      }
      const item = addresses.get(message.step)
      opts.send(item === undefined ? message : { ...message, step: item.step }, causedBy)
    },
    forward(event) {
      const offset = opts.path.length
      const address = event.path[offset]
      const item = address === undefined ? undefined : addresses.get(address)
      opts.forward(
        item === undefined
          ? event
          : {
              ...event,
              path: [
                ...event.path.slice(0, offset),
                item.step,
                String(item.index),
                ...event.path.slice(offset + 1),
              ],
            },
      )
    },
  })

  const isIndexed = (address: string): boolean => addresses.has(address)
  const remove = (address: string): void => {
    const item = addresses.get(address)
    indexed.dispose(address)
    addresses.delete(address)
    delete definitions[address]
    if (item === undefined) return
    const owned = byStep.get(item.step)
    owned?.delete(address)
    if (owned?.size === 0) byStep.delete(item.step)
  }

  return {
    create(step, context, causedBy, itemIndex?: number) {
      if (itemIndex === undefined) {
        plain.create(step, context, causedBy)
        return
      }
      const each = opts.getState().steps[step]?.each
      const key = each?.keys[itemIndex]
      if (key === undefined) return
      const address = eachChildAddress(step, itemIndex, key, opts.def.steps)
      register(address, { step, index: itemIndex, key })
      indexed.create(address, context, causedBy)
    },
    restore(address, plan) {
      const item = Object.hasOwn(opts.def.steps, address)
        ? undefined
        : parseEachChildAddress(address)
      if (item === undefined) {
        plain.restore(address, plan)
        return
      }
      register(address, item)
      indexed.restore(address, plan)
    },
    resumeRestored() {
      plain.resumeRestored()
      indexed.resumeRestored()
    },
    send(address, command) {
      if (isIndexed(address)) indexed.send(address, command)
      else {
        plain.send(address, command)
        for (const child of byStep.get(address) ?? []) indexed.send(child, command)
      }
    },
    dispose(address) {
      if (isIndexed(address)) remove(address)
      else {
        plain.dispose(address)
        for (const child of Array.from(byStep.get(address) ?? [])) remove(child)
      }
    },
    disposeAll() {
      plain.disposeAll()
      indexed.disposeAll()
      addresses.clear()
      byStep.clear()
      for (const address of Object.keys(definitions)) delete definitions[address]
    },
    get(address, item) {
      if (item === undefined) return (isIndexed(address) ? indexed : plain).get(address)
      const each = opts.getState().steps[address]?.each
      if (each === undefined) return undefined
      const index = typeof item === 'number' ? item : each.keys.indexOf(item)
      if (!Number.isSafeInteger(index) || index < 0 || index >= each.items.length) return undefined
      const key = each.keys[index]
      if (key === undefined) return undefined
      return indexed.get(eachChildAddress(address, index, key, opts.def.steps))
    },
    has(address) {
      if (isIndexed(address)) return indexed.has(address)
      if (plain.has(address)) return true
      for (const child of byStep.get(address) ?? []) if (indexed.has(child)) return true
      return false
    },
    snapshots() {
      return { ...plain.snapshots(), ...indexed.snapshots() }
    },
  }
}

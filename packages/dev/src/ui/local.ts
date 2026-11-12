import { inspect, toMarkdown } from '@openwizard/core/inspect'
import type { DevConfig } from '../config'
import { registryFrom } from '../server/registry'
import { createRunStore } from '../server/runs'
import type { Backend, Notice } from './backend'

/**
 * A backend that holds the wizards and their runs in this page, with no server. It uses the
 * same run store as `openwizard dev`, so the UI behaves the same. `label` is shown where the
 * dev server shows its entry file.
 */
export function localBackend(config: DevConfig, label = 'in this page'): Backend {
  const registry = registryFrom(label, config, { inspect, toMarkdown }, Date.now())
  const listeners = new Set<(notice: Notice) => void>()
  const runs = createRunStore(
    () => registry,
    (run) => {
      for (const listener of listeners) listener({ run })
    },
  )
  return {
    place: 'page',
    catalog: async () => registry.catalog,
    runs: async () => runs.list(),
    run: async (id) => runs.get(id),
    start: async (request) => runs.start(request),
    act: (id, action) => runs.act(id, action),
    remove: async (id) => {
      const removed = runs.remove(id)
      for (const listener of listeners) listener({})
      return removed
    },
    subscribe(onNotice, onOpen) {
      listeners.add(onNotice)
      onOpen(true)
      return () => listeners.delete(onNotice)
    },
  }
}

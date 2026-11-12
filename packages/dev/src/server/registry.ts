import { configFrom, type DevWizard } from '../config'
import type { Catalog, WizardInfo } from '../wire'
import { exampleOf } from './example'
import type { LoadedEntry } from './load'

/** A loaded wizard: its dev entry and the facts the UI shows. */
export interface Loaded {
  readonly dev: DevWizard
  readonly info: WizardInfo
}

/** The wizards of the entry file as they were at the last load. */
export interface Registry {
  readonly catalog: Catalog
  find(name: string): Loaded | undefined
}

/** Builds a registry from a load of the entry file. A wizard that cannot be inspected is reported, not dropped. */
export function registryFrom(entry: string, load: LoadedEntry, now: number): Registry {
  const { inspect, toMarkdown } = load.inspector
  const loaded = new Map<string, Loaded>()
  const problems: string[] = []
  for (const dev of configFrom(load.exports).wizards) {
    try {
      const manifest = inspect(dev.wizard)
      loaded.set(manifest.name, {
        dev,
        info: {
          name: manifest.name,
          ...(manifest.description === undefined ? {} : { description: manifest.description }),
          version: manifest.version,
          manifest,
          markdown: toMarkdown(manifest),
          exampleInput: dev.input ?? exampleOf(manifest.schemas.context),
          hasDeps: dev.deps !== undefined,
          services: Object.keys(dev.deps ?? {}),
          events: dev.events ?? {},
        },
      })
    } catch (error) {
      problems.push(error instanceof Error ? error.message : String(error))
    }
  }
  if (loaded.size === 0 && problems.length === 0)
    problems.push(
      'The entry file exports no wizard. Export a wizard, or a `defineDev` config as the default export.',
    )
  return {
    catalog: {
      entry,
      loadedAt: now,
      wizards: [...loaded.values()].map((item) => item.info),
      ...(problems.length === 0 ? {} : { error: problems.join('\n') }),
    },
    find: (name) => loaded.get(name),
  }
}

/** The registry shown when the entry file failed to load. */
export function failedRegistry(entry: string, error: unknown, now: number): Registry {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  return { catalog: { entry, loadedAt: now, wizards: [], error: message }, find: () => undefined }
}

import { type FSWatcher, watch } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { inspect, toMarkdown } from '@openwizard/core/inspect'
import { register } from 'tsx/esm/api'
import type { Inspector } from './registry'

/** One load of the entry file. */
export interface LoadedEntry {
  readonly exports: Readonly<Record<string, unknown>>
  /**
   * `inspect` from the copy of `@openwizard/core` the entry file imports. A fresh load has its
   * own copy of every module, and a wizard is only valid to the copy that defined it.
   */
  readonly inspector: Inspector
  /** The source files the entry file imported, outside `node_modules`. */
  readonly files: readonly string[]
}

let loads = 0

/**
 * Imports the entry file, TypeScript included. Every call evaluates the file and everything it
 * imports again, so an edit shows up without restarting the server.
 */
export async function loadEntry(entry: string): Promise<LoadedEntry> {
  const files = new Set<string>([entry])
  const scope = register({
    namespace: `openwizard-dev-${process.pid}-${++loads}`,
    onImport: (url) => {
      if (url.startsWith('file:') && !url.includes('/node_modules/'))
        files.add(fileURLToPath(url.split('?')[0] as string))
    },
  })
  const parent = pathToFileURL(entry).href
  try {
    const exports = (await scope.import(parent, import.meta.url)) as Record<string, unknown>
    const inspector = (await scope
      .import('@openwizard/core/inspect', parent)
      .catch(() => ({ inspect, toMarkdown }))) as Inspector
    return { exports, inspector, files: [...files] }
  } finally {
    await scope.unregister()
  }
}

/** Watches the files of a load. `set` replaces the files, and `close` stops watching. */
export interface FileWatch {
  set(files: readonly string[]): void
  close(): void
}

/** Calls `onChange` shortly after one of the watched files changes. */
export function watchFiles(onChange: () => void): FileWatch {
  const watchers = new Map<string, FSWatcher>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const changed = () => {
    clearTimeout(timer)
    timer = setTimeout(onChange, 120)
  }
  return {
    set(files) {
      const wanted = new Set(files)
      for (const [file, watcher] of watchers) {
        if (wanted.has(file)) continue
        watcher.close()
        watchers.delete(file)
      }
      for (const file of wanted) {
        if (watchers.has(file)) continue
        try {
          const watcher = watch(file, changed)
          // A watcher error must not take the dev server down. Reloading by hand still works.
          watcher.on('error', () => {})
          watchers.set(file, watcher)
        } catch {
          // The file was removed between the load and now.
        }
      }
    },
    close() {
      clearTimeout(timer)
      for (const watcher of watchers.values()) watcher.close()
      watchers.clear()
    },
  }
}

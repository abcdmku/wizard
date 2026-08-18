import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MonacoApi } from './monaco-setup'
import type { PlaygroundRunner, RunnerSnapshot } from './runner'
import type { PlaygroundFile, PlaygroundSample } from './samples'

export interface PlaygroundState {
  readonly sample: PlaygroundSample
  readonly files: readonly PlaygroundFile[]
  readonly activeFile: string
  readonly setActiveFile: (name: string) => void
  readonly updateFile: (name: string, content: string) => void
  readonly loadSample: (sample: PlaygroundSample) => void
  /** True once Monaco is loaded and every file has a model — then `run` can compile. */
  readonly editorReady: boolean
  readonly onEditorReady: (api: MonacoApi) => void
  readonly run: () => void
  readonly snapshot: RunnerSnapshot
}

const IDLE: RunnerSnapshot = {
  status: 'idle',
  error: null,
  diagnostics: [],
  wizards: [],
  flows: [],
  trace: [],
  console: [],
  version: 0,
}

/** Editor files + the runner session behind an IDE (landing or playground). */
export function usePlayground(initial: PlaygroundSample): PlaygroundState {
  const [sample, setSample] = useState(initial)
  const [files, setFiles] = useState<readonly PlaygroundFile[]>(initial.files)
  const [activeFile, setActiveFile] = useState(initial.files[0]?.name ?? '')
  const [monacoApi, setMonacoApi] = useState<MonacoApi | null>(null)
  const [snapshot, setSnapshot] = useState<RunnerSnapshot>(IDLE)
  const runnerRef = useRef<Promise<PlaygroundRunner> | null>(null)
  const unsubscribeRef = useRef<(() => void) | null>(null)

  // The runner pulls in @openwizard/core and zod: loaded on the first Run, not with the page.
  const runner = useCallback((): Promise<PlaygroundRunner> => {
    runnerRef.current ??= import('./runner').then(({ createRunner }) => {
      const created = createRunner()
      unsubscribeRef.current = created.subscribe(() => setSnapshot(created.getSnapshot()))
      return created
    })
    return runnerRef.current
  }, [])

  useEffect(
    () => () => {
      unsubscribeRef.current?.()
      void runnerRef.current?.then((created) => created.dispose())
    },
    [],
  )

  const updateFile = useCallback((name: string, content: string) => {
    setFiles((current) => current.map((file) => (file.name === name ? { name, content } : file)))
  }, [])

  const loadSample = useCallback((next: PlaygroundSample) => {
    setSample(next)
    setFiles(next.files)
    setActiveFile(next.files[0]?.name ?? '')
  }, [])

  const run = useCallback(() => {
    if (!monacoApi) return
    const names = files.map((file) => file.name)
    void runner().then((created) => created.run(names, sample.entry, monacoApi))
  }, [runner, files, sample.entry, monacoApi])

  // Keep the first API object: the editor reports readiness again after every model sync.
  const onEditorReady = useCallback(
    (api: MonacoApi) => setMonacoApi((current) => current ?? api),
    [],
  )

  return useMemo(
    () => ({
      sample,
      files,
      activeFile,
      setActiveFile,
      updateFile,
      loadSample,
      editorReady: monacoApi !== null,
      onEditorReady,
      run,
      snapshot,
    }),
    [sample, files, activeFile, updateFile, loadSample, monacoApi, onEditorReady, run, snapshot],
  )
}

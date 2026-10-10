import { type ComponentProps, type ComponentType, type ReactNode, useEffect, useState } from 'react'
import { useTheme } from '../../theme/theme-provider'
import type { MonacoApi } from './monaco-setup'
import type { PlaygroundFile } from './samples'

type MonacoModule = typeof import('./monaco-setup')

interface CodeEditorProps {
  readonly files: readonly PlaygroundFile[]
  readonly activeFile: string
  readonly onChange: (name: string, content: string) => void
  /** Called once Monaco is loaded and every file has a model (the runner needs the models). */
  readonly onReady?: ((api: MonacoApi) => void) | undefined
}

let monacoModule: Promise<MonacoModule> | null = null

/**
 * Monaco is browser-only: loaded after mount, never during prerendering. The `SSR` guard is a
 * build-time constant, so the server bundle does not even contain the import.
 */
function loadMonaco(): Promise<MonacoModule> {
  if (import.meta.env.SSR) return new Promise(() => undefined)
  monacoModule ??= import('./monaco-setup').then((mod) => {
    mod.setupMonaco()
    return mod
  })
  return monacoModule
}

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 20,
  fontFamily:
    "ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  fontLigatures: false,
  lineNumbersMinChars: 3,
  glyphMargin: false,
  folding: false,
  lineDecorationsWidth: 8,
  overviewRulerLanes: 0,
  overviewRulerBorder: false,
  renderLineHighlight: 'none',
  tabSize: 2,
  automaticLayout: true,
  bracketPairColorization: { enabled: true },
  scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  padding: { top: 10, bottom: 10 },
  fixedOverflowWidgets: true,
} as const

function EditorShell({ children }: { readonly children?: ReactNode }) {
  return <div className="h-full w-full bg-paper-2 dark:bg-ink-2">{children}</div>
}

/** The Monaco editor over the playground files (one model per file, switched by `activeFile`). */
export function CodeEditor({ files, activeFile, onChange, onReady }: CodeEditorProps) {
  const { resolvedTheme } = useTheme()
  const [loaded, setLoaded] = useState<MonacoModule | null>(null)
  const [Editor, setEditor] = useState<ComponentType<EditorProps> | null>(null)

  useEffect(() => {
    let cancelled = false
    loadMonaco().then((mod) => {
      if (cancelled) return
      setLoaded(mod)
      setEditor(() => mod.Editor)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Every file needs a model up front — the TypeScript worker resolves `./deps` through it, and
  // the runner emits every file — not only the tab the user opened.
  useEffect(() => {
    if (!loaded) return
    const { monaco } = loaded
    for (const file of files) {
      const uri = monaco.Uri.parse(`file:///${file.name}`)
      const model = monaco.editor.getModel(uri)
      if (!model) monaco.editor.createModel(file.content, 'typescript', uri)
      else if (model.getValue() !== file.content && file.name !== activeFile)
        model.setValue(file.content)
    }
    onReady?.({ monaco, getTypeScriptWorker: loaded.getTypeScriptWorker })
  }, [loaded, files, activeFile, onReady])

  const active = files.find((file) => file.name === activeFile)
  if (!Editor || !loaded || !active) {
    return (
      <EditorShell>
        <div className="flex h-full items-center justify-center font-mono text-xs text-neutral-500">
          Loading editor…
        </div>
      </EditorShell>
    )
  }
  return (
    <EditorShell>
      <Editor
        path={`file:///${active.name}`}
        language="typescript"
        value={active.content}
        theme={resolvedTheme === 'dark' ? loaded.THEME_DARK : loaded.THEME_LIGHT}
        onChange={(value) => onChange(active.name, value ?? '')}
        options={EDITOR_OPTIONS}
        loading={null}
        height="100%"
      />
    </EditorShell>
  )
}

type EditorProps = ComponentProps<MonacoModule['Editor']>

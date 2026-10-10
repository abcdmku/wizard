import { useState } from 'react'
import { CopyButton } from '../mdx/copy-button'
import { CodeEditor } from './code-editor'
import { PreviewPane } from './preview-pane'
import type { PlaygroundSample } from './samples'
import type { PlaygroundState } from './use-playground'

interface IdeProps {
  readonly state: PlaygroundState
  readonly title: string
  /** When given, a picker in the title bar loads one of these samples. */
  readonly samples?: readonly PlaygroundSample[]
  readonly currentSampleId?: string
  /** Tailwind width classes of the preview column on `lg+` screens. */
  readonly previewClassName?: string
}

const TRAFFIC_LIGHTS = ['#ef4444', '#f59e0b', '#10b981'] as const

/** The IDE mock: title bar, file tabs, Monaco on the left, the live preview on the right. */
export function Ide({
  state,
  title,
  samples,
  currentSampleId,
  previewClassName = 'lg:w-[300px] xl:w-[360px]',
}: IdeProps) {
  const [mobileView, setMobileView] = useState<'code' | 'preview'>('code')
  const active = state.files.find((file) => file.name === state.activeFile)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-paper-2 shadow-[0_4px_40px_rgba(0,0,0,0.07)] dark:border-neutral-800 dark:bg-ink-2 dark:shadow-[0_4px_40px_rgba(0,0,0,0.5)]">
      {/* Title bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2">
          {TRAFFIC_LIGHTS.map((color) => (
            <span
              key={color}
              className="h-2.5 w-2.5 rounded-full"
              style={{ background: color }}
              aria-hidden="true"
            />
          ))}
          <span className="ml-1 truncate font-mono text-[11px] text-neutral-500">{title}</span>
        </div>
        <div className="flex items-center gap-2">
          {samples && (
            <select
              aria-label="Load an example"
              value={currentSampleId ?? ''}
              onChange={(event) => {
                const sample = samples.find((candidate) => candidate.id === event.target.value)
                if (sample) state.loadSample(sample)
              }}
              className="max-w-[12rem] rounded border border-neutral-200 bg-transparent px-1.5 py-0.5 font-mono text-[11px] text-neutral-600 dark:border-neutral-700 dark:text-neutral-300"
            >
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.title}
                </option>
              ))}
            </select>
          )}
          <CopyButton text={active?.content ?? ''} label="Copy file" />
        </div>
      </div>

      {/* Mobile: Code / Preview */}
      <div className="flex shrink-0 border-b border-neutral-200 lg:hidden dark:border-neutral-800">
        {(['code', 'preview'] as const).map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => setMobileView(view)}
            className={`flex-1 border-b-2 py-2 font-mono text-xs capitalize transition-colors ${
              mobileView === view
                ? 'border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                : 'border-transparent text-neutral-500'
            }`}
          >
            {view}
          </button>
        ))}
      </div>

      {/* File tabs */}
      <div
        className={`shrink-0 gap-0.5 overflow-x-auto border-b border-neutral-200 px-2 dark:border-neutral-800 ${
          mobileView === 'preview' ? 'hidden lg:flex' : 'flex'
        }`}
      >
        {state.files.map((file) => {
          const selected = file.name === state.activeFile
          return (
            <button
              key={file.name}
              type="button"
              onClick={() => state.setActiveFile(file.name)}
              className={`shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 font-mono text-xs transition-colors ${
                selected
                  ? 'border-neutral-900 text-neutral-900 dark:border-neutral-100 dark:text-neutral-100'
                  : 'border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
              }`}
            >
              {file.name}
            </button>
          )
        })}
      </div>

      {/* Editor + preview */}
      <div className="flex min-h-0 flex-1">
        <div
          className={`relative min-h-0 min-w-0 flex-1 border-neutral-200 lg:border-r dark:border-neutral-800 ${
            mobileView === 'preview' ? 'hidden lg:block' : 'block'
          }`}
        >
          <div className="absolute inset-0">
            <CodeEditor
              files={state.files}
              activeFile={state.activeFile}
              onChange={state.updateFile}
              onReady={state.onEditorReady}
            />
          </div>
        </div>
        <div
          className={`min-h-0 shrink-0 ${previewClassName} ${
            mobileView === 'code' ? 'hidden lg:block' : 'block w-full'
          }`}
        >
          <PreviewPane snapshot={state.snapshot} onRun={state.run} canRun={state.editorReady} />
        </div>
      </div>
    </div>
  )
}

import { type KeyboardEvent, useState } from 'react'
import { CopyButton } from '../mdx/copy-button'
import { CodeEditor } from './code-editor'
import { FOCUS_RING, RunButton, tabClass } from './controls'
import { PreviewPane } from './preview-pane'
import type { PlaygroundSample } from './samples'
import type { PlaygroundState } from './use-playground'

interface IdeProps {
  readonly state: PlaygroundState
  readonly title: string
  /** A longer line after the title, shown once the title bar has room for it. */
  readonly subtitle?: string
  /** When given, a picker in the title bar loads one of these samples. */
  readonly samples?: readonly PlaygroundSample[]
  readonly currentSampleId?: string
  /** Called with the picked sample. Without it the picker loads the sample itself. */
  readonly onPickSample?: (sample: PlaygroundSample) => void
  /** Tailwind width classes of the preview column once the IDE is wide enough to split. */
  readonly previewClassName?: string
}

const TRAFFIC_LIGHTS = ['#ef4444', '#f59e0b', '#10b981'] as const

/** The IDE mock: title bar, file tabs, Monaco on the left, the live preview on the right. */
export function Ide({
  state,
  title,
  subtitle,
  samples,
  currentSampleId,
  onPickSample,
  previewClassName = '@2xl/ide:w-[240px] @4xl/ide:w-[300px] @6xl/ide:w-[350px]',
}: IdeProps) {
  const [mobileView, setMobileView] = useState<'code' | 'preview'>('code')
  const active = state.files.find((file) => file.name === state.activeFile)

  // On a narrow screen the result is behind the Preview tab, so running also opens it.
  const run = () => {
    state.run()
    setMobileView('preview')
  }
  // Capture phase: Monaco would otherwise take Ctrl/Cmd + Enter to insert a line.
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return
    event.preventDefault()
    event.stopPropagation()
    if (state.editorReady) run()
  }

  return (
    <div
      className="@container/ide flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-paper-2 shadow-[0_4px_40px_rgba(0,0,0,0.07)] dark:border-neutral-800 dark:bg-ink-2 dark:shadow-[0_4px_40px_rgba(0,0,0,0.5)]"
      onKeyDownCapture={onKeyDownCapture}
    >
      {/* Title bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
        <div className="flex min-w-0 items-center gap-2">
          <span className="@md/ide:flex hidden shrink-0 items-center gap-2" aria-hidden="true">
            {TRAFFIC_LIGHTS.map((color) => (
              <span
                key={color}
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: color }}
              />
            ))}
          </span>
          <span className="@md/ide:ml-1 shrink-0 font-mono text-[11px] text-neutral-800 dark:text-neutral-200">
            {title}
          </span>
          {subtitle && (
            <span className="@3xl/ide:inline hidden truncate font-mono text-[11px] text-neutral-500 dark:text-neutral-400">
              · {subtitle}
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2">
          {samples && (
            <select
              aria-label="Load an example"
              value={currentSampleId ?? ''}
              onChange={(event) => {
                const sample = samples.find((candidate) => candidate.id === event.target.value)
                if (!sample) return
                if (onPickSample) onPickSample(sample)
                else state.loadSample(sample)
              }}
              className={`h-7 w-[17rem] min-w-0 shrink rounded-md border border-neutral-200 bg-paper px-2 font-mono text-[11px] text-neutral-700 dark:border-neutral-700 dark:bg-ink dark:text-neutral-300 [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:text-xs ${FOCUS_RING}`}
            >
              {samples.map((sample) => (
                <option key={sample.id} value={sample.id}>
                  {sample.title}
                </option>
              ))}
            </select>
          )}
          <CopyButton
            text={active?.content ?? ''}
            label={`Copy ${active?.name ?? 'file'}`}
            className={`h-7 w-7 shrink-0 justify-center [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9 ${FOCUS_RING}`}
          />
        </div>
      </div>

      {/* Narrow: Code / Preview, with Run always in reach */}
      <div className="@2xl/ide:hidden flex shrink-0 items-center justify-between gap-2 border-b border-neutral-200 pr-2 pl-1 dark:border-neutral-800">
        <div className="flex" role="tablist" aria-label="Pane">
          {(['code', 'preview'] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={mobileView === view}
              onClick={() => setMobileView(view)}
              className={`${tabClass(mobileView === view)} capitalize`}
            >
              {view}
            </button>
          ))}
        </div>
        <RunButton onRun={run} canRun={state.editorReady} status={state.snapshot.status} />
      </div>

      {/* File tabs */}
      <div
        className={`shrink-0 overflow-x-auto border-b border-neutral-200 px-1 dark:border-neutral-800 ${
          mobileView === 'preview' ? '@2xl/ide:flex hidden' : 'flex'
        }`}
      >
        {state.files.map((file) => (
          <button
            key={file.name}
            type="button"
            aria-pressed={file.name === state.activeFile}
            onClick={() => state.setActiveFile(file.name)}
            className={tabClass(file.name === state.activeFile)}
          >
            {file.name}
          </button>
        ))}
      </div>

      {/* Editor + preview */}
      <div className="flex min-h-0 flex-1">
        <div
          className={`@2xl/ide:border-r relative min-h-0 min-w-0 flex-1 border-neutral-200 dark:border-neutral-800 ${
            mobileView === 'preview' ? '@2xl/ide:block hidden' : 'block'
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
          className={`min-h-0 min-w-0 shrink-0 ${previewClassName} ${
            mobileView === 'code' ? '@2xl/ide:block hidden' : 'block w-full'
          }`}
        >
          <PreviewPane snapshot={state.snapshot} onRun={run} canRun={state.editorReady} />
        </div>
      </div>
    </div>
  )
}

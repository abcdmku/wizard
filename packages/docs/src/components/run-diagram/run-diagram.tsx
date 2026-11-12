import { inspect } from '@openwizard/core/inspect'
import { RotateCcw } from 'lucide-react'
import { type CSSProperties, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { graphWidth, RunGraph } from './graph'
import { createLive, type Live, type LiveState, stepKey } from './live'
import { LivePortal } from './live-portal'
import { liveSpecs } from './live-specs'

const noop = () => () => {}

/** Follows a live run, or nothing before the page has mounted. */
function useLiveState(live: Live | undefined): LiveState | undefined {
  return useSyncExternalStore(
    live ? live.subscribe : noop,
    () => live?.getState(),
    () => undefined,
  )
}

/** The calls the page made, newest first, each with what it returned and what the run reported. */
function CallLog({ state }: { readonly state: LiveState | undefined }) {
  if (!state) return <p className="rd-note">Loading the run.</p>
  return (
    <ol className="lv-log" aria-label="Calls this page made" aria-live="polite">
      {[...state.log].reverse().map((entry, index) => (
        <li key={entry.id} className={index === 0 ? 'is-latest' : ''}>
          <pre className="rd-call">
            <code>{entry.call}</code>
          </pre>
          {entry.returned && <p className="rd-returned">{entry.returned}</p>}
          {entry.events.length > 0 && (
            <ul className="rd-events" aria-label="Events">
              {entry.events.map((event) => (
                <li key={event}>{event}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * A wizard's steps next to a real run of it that the reader drives: they fill in the forms,
 * send the events, answer the service calls and move time forward. `name` picks the examples
 * from `live-specs.ts`. With several, the reader switches between them.
 */
export function RunDiagram({ name }: { readonly name: string }) {
  const variants = liveSpecs[name]
  if (!variants || variants.length === 0) throw new Error(`RunDiagram: no example named '${name}'`)
  const [variant, setVariant] = useState(0)
  const [generation, setGeneration] = useState(0)
  const spec = variants[variant] ?? variants[0]
  if (!spec) throw new Error(`RunDiagram: no example named '${name}'`)

  const manifest = useMemo(() => inspect(spec.wizard), [spec])
  const [live, setLive] = useState<Live>()
  // The run is created in the browser only, and again for each restart.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `generation` restarts the run
  useEffect(() => {
    const next = createLive(spec)
    setLive(next)
    return () => next.dispose()
  }, [spec, generation])
  const state = useLiveState(live)
  const restart = () => setGeneration((count) => count + 1)

  const idle = useMemo(
    () =>
      Object.fromEntries(
        manifest.nodes.map((node) => [stepKey(node.path, node.id), { status: 'idle' }]),
      ),
    [manifest],
  )
  return (
    <figure className="run-diagram live-run not-prose" data-run-diagram={name}>
      <div className="rd-head">
        <span className="rd-title">Live run · in your browser</span>
        {variants.length > 1 && (
          <div className="rd-tabs" role="tablist" aria-label="Example">
            {variants.map((option, i) => (
              <button
                key={option.label}
                type="button"
                role="tab"
                aria-selected={i === variant}
                className={i === variant ? 'is-selected' : ''}
                onClick={() => setVariant(i)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="lv-restart" onClick={restart} disabled={!state?.started}>
          <RotateCcw aria-hidden="true" />
          Start over
        </button>
      </div>

      <div
        className="rd-body"
        style={{ '--rd-graph': `${graphWidth(manifest)}px` } as CSSProperties}
      >
        <div className="rd-stage">
          <RunGraph manifest={manifest} steps={state?.steps ?? idle} />
        </div>
        {/* The side has a fixed size and scrolls inside, so a click never moves the page. */}
        <div className="lv-side">
          <div className="lv-side-inner">
            {live && state && (
              <LivePortal
                key={`${variant}:${generation}`}
                live={live}
                state={state}
                restart={restart}
              />
            )}
            <div className="lv-panel">
              <p className="lv-portal-title">Calls this page made</p>
              <CallLog state={state} />
            </div>
          </div>
        </div>
      </div>
    </figure>
  )
}

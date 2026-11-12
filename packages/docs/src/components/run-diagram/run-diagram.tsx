import { inspect } from '@openwizard/core/inspect'
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Look, lookOf, RunGraph } from './graph'
import { type Frame, type Recording, record, type Scenario, stepKey } from './record'
import { scenarios } from './scenarios'

const FRAME_MS = 1400

/** Every look a step can take, in the order the legend lists them. */
const LEGEND: readonly (readonly [Look, string])[] = [
  ['running', 'running'],
  ['waiting', 'waiting'],
  ['done', 'done'],
  ['skipped', 'skipped'],
  ['failed', 'failed'],
  ['undoing', 'undoing'],
  ['undone', 'undone'],
]

/** Recordings are deterministic, so one per scenario serves every diagram on the site. */
const recordings = new WeakMap<Scenario, Promise<Recording>>()
const recordingOf = (scenario: Scenario): Promise<Recording> => {
  let pending = recordings.get(scenario)
  if (!pending) {
    pending = record(scenario)
    recordings.set(scenario, pending)
  }
  return pending
}

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Plays a recording: the current frame, and whether it advances by itself. */
function usePlayer(frames: readonly Frame[] | undefined) {
  const [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const count = frames?.length ?? 0
  const lastIndex = Math.max(0, count - 1)

  useEffect(() => {
    if (!playing) return
    if (index >= lastIndex) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setIndex((current) => current + 1), FRAME_MS)
    return () => clearTimeout(timer)
  }, [playing, index, lastIndex])

  return {
    index: Math.min(index, lastIndex),
    playing,
    atEnd: index >= lastIndex,
    seek(next: number) {
      setPlaying(false)
      setIndex(Math.max(0, Math.min(lastIndex, next)))
    },
    toggle() {
      if (playing) return setPlaying(false)
      if (index >= lastIndex) setIndex(0)
      setPlaying(true)
    },
    play() {
      setIndex(0)
      setPlaying(true)
    },
    reset() {
      setPlaying(false)
      setIndex(0)
    },
  }
}

/**
 * A diagram of a wizard that replays a real run of it. `name` picks the scenarios from
 * `scenarios.ts`. With several, the reader switches between them.
 */
export function RunDiagram({ name }: { readonly name: string }) {
  const variants = scenarios[name]
  if (!variants || variants.length === 0) throw new Error(`RunDiagram: no scenario named '${name}'`)
  const [variant, setVariant] = useState(0)
  const scenario = variants[variant] ?? variants[0]
  if (!scenario) throw new Error(`RunDiagram: no scenario named '${name}'`)

  const manifest = useMemo(() => inspect(scenario.wizard), [scenario])
  const [recording, setRecording] = useState<Recording>()
  const player = usePlayer(recording?.frames)
  const figure = useRef<HTMLElement>(null)
  const started = useRef(false)

  useEffect(() => {
    let current = true
    setRecording(undefined)
    recordingOf(scenario).then((next) => {
      if (current) setRecording(next)
    })
    return () => {
      current = false
    }
  }, [scenario])

  // Play once when the reader scrolls the diagram into view.
  const { play } = player
  // biome-ignore lint/correctness/useExhaustiveDependencies: `play` is stable enough; the effect must run once per recording
  useEffect(() => {
    const element = figure.current
    if (!recording || started.current || !element || prefersReducedMotion()) return
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || started.current) return
        started.current = true
        observer.disconnect()
        play()
      },
      { threshold: 0.6 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [recording])

  const idle = useMemo(
    () =>
      Object.fromEntries(
        manifest.nodes.map((node) => [stepKey(node.path, node.id), { status: 'idle' }]),
      ),
    [manifest],
  )
  const frames = recording?.frames
  // The legend lists only the colours this run uses.
  const legend = useMemo(() => {
    const used = new Set<Look>()
    for (const item of frames ?? []) {
      for (const step of Object.values(item.steps)) used.add(lookOf(step))
    }
    return LEGEND.filter(([look]) => used.has(look))
  }, [frames])
  const frame = frames?.[player.index]
  const runStatus = frame?.run === 'none' ? 'not created' : (frame?.run ?? 'idle')

  return (
    <figure ref={figure} className="run-diagram not-prose" data-run-diagram={name}>
      <div className="rd-head">
        <span className="rd-title">Watch it run</span>
        {variants.length > 1 && (
          <div className="rd-tabs" role="tablist" aria-label="Scenario">
            {variants.map((option, i) => (
              <button
                key={option.label}
                type="button"
                role="tab"
                aria-selected={i === variant}
                className={i === variant ? 'is-selected' : ''}
                onClick={() => {
                  started.current = true
                  player.reset()
                  setVariant(i)
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rd-body">
        <div className="rd-stage">
          <RunGraph manifest={manifest} steps={frame?.steps ?? idle} />
          <ul className="rd-legend" aria-label="Step colours">
            {legend.map(([look, label]) => (
              <li key={look}>
                <span className={`rd-swatch is-${look}`} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="rd-panel">
          <p className="rd-run">
            run <span className={`rd-run-status is-${frame?.run ?? 'idle'}`}>{runStatus}</span>
          </p>
          {frame ? (
            <>
              <pre className="rd-call">
                <code>{frame.call}</code>
              </pre>
              {frame.returned && <p className="rd-returned">{frame.returned}</p>}
              <p className="rd-note">{frame.note}</p>
              {frame.events.length > 0 && (
                <ul className="rd-events" aria-label="Events">
                  {frame.events.map((event) => (
                    <li key={event}>{event}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="rd-note">{variants.length > 1 ? scenario.label : 'Loading the run.'}</p>
          )}
        </div>
      </div>

      <div className="rd-controls">
        <button
          type="button"
          className="rd-play"
          onClick={player.toggle}
          disabled={!frames}
          aria-label={player.playing ? 'Pause' : player.atEnd ? 'Play again' : 'Play'}
        >
          {player.playing ? (
            <Pause aria-hidden="true" />
          ) : player.atEnd && frames ? (
            <RotateCcw aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          onClick={() => player.seek(player.index - 1)}
          disabled={!frames || player.index === 0}
          aria-label="Previous change"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => player.seek(player.index + 1)}
          disabled={!frames || player.atEnd}
          aria-label="Next change"
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <ol className="rd-track">
          {(frames ?? []).map((item, i) => {
            const newCall = i === 0 || frames?.[i - 1]?.call !== item.call
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: frames are a fixed, ordered recording
              <li key={i}>
                <button
                  type="button"
                  className={`${newCall ? 'is-call' : ''} ${i === player.index ? 'is-current' : i < player.index ? 'is-past' : ''}`}
                  onClick={() => player.seek(i)}
                  aria-label={`Change ${i + 1} of ${frames?.length}: ${item.call}`}
                  aria-current={i === player.index ? 'step' : undefined}
                />
              </li>
            )
          })}
        </ol>
        <span className="rd-count">{frames ? `${player.index + 1} / ${frames.length}` : ''}</span>
      </div>
    </figure>
  )
}

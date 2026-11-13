import { type ReactElement, useEffect, useRef } from 'react'
import type { RunSummary, WizardInfo } from '../wire'
import { clock, runTag, span } from './format'
import { Go, type Route } from './nav'
import { runWord, wordTone } from './status-word'
import { reveal } from './tabs'

const todo = (count: number): string =>
  `${count} ${count === 1 ? 'thing waits' : 'things wait'} for you`

function RunLink(props: {
  readonly run: RunSummary
  readonly active: boolean
  readonly now: number
}) {
  const { run } = props
  const word = runWord(run.status, run.waiting)
  return (
    <Go className="nav-item nav-run" to={{ page: 'run', id: run.id }} current={props.active}>
      <span className="dot" data-status={wordTone(word)} aria-hidden="true" />
      <span className="nav-main">
        <span className="nav-name">
          {run.wizard} <span className="run-tag">{runTag(run.id)}</span>
        </span>
        <span className="nav-sub">{word}</span>
      </span>
      {run.waiting > 0 && (
        <span className="count" title={todo(run.waiting)}>
          {run.waiting}
          <span className="visually-hidden"> {run.waiting === 1 ? 'thing' : 'things'} to do</span>
        </span>
      )}
      <span className="nav-age" title={`Started ${clock(run.createdAt)}`}>
        {span(props.now - run.createdAt)}
      </span>
    </Go>
  )
}

function Group(props: {
  readonly name: 'wizards' | 'runs'
  readonly title: string
  readonly empty: string | undefined
  readonly children: ReactElement[]
}) {
  return (
    <div
      className="side-group"
      data-group={props.name}
      data-empty={props.children.length === 0 || undefined}
    >
      <h2>{props.title}</h2>
      {props.children}
      {props.children.length === 0 && <p className="side-empty">{props.empty}</p>}
    </div>
  )
}

/**
 * The wizards and the runs: a sidebar in a wide frame, one row of chips in a narrow one. In the
 * row the runs come first, with the open run at the start, and the selected chip scrolls into view.
 */
export function Side(props: {
  readonly wizards: readonly WizardInfo[]
  readonly runs: readonly RunSummary[]
  readonly route: Route
  readonly now: number
}): ReactElement {
  const { route } = props
  const nav = useRef<HTMLElement>(null)
  const where = route.page === 'run' ? route.id : route.page === 'wizard' ? route.name : ''
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the route or the list changes
  useEffect(() => {
    const box = nav.current
    const current = box?.querySelector<HTMLElement>('[aria-current="page"]')
    if (box && current) reveal(box, current)
  }, [where, props.runs.length])
  return (
    <nav ref={nav} className="side" aria-label="Wizards and runs">
      <Group name="wizards" title="Wizards" empty="No wizard loaded.">
        {props.wizards.map((item) => {
          const steps = item.manifest.nodes.filter((node) => node.path.length === 0).length
          return (
            <Go
              key={item.name}
              className="nav-item"
              to={{ page: 'wizard', name: item.name }}
              current={route.page === 'wizard' && route.name === item.name}
            >
              <span className="nav-main nav-name">{item.name}</span>
              <span className="nav-age">{steps} steps</span>
            </Go>
          )
        })}
      </Group>
      <Group name="runs" title="Runs" empty="No runs yet. Start one from a wizard.">
        {props.runs.map((run) => (
          <RunLink
            key={run.id}
            run={run}
            now={props.now}
            active={route.page === 'run' && route.id === run.id}
          />
        ))}
      </Group>
    </nav>
  )
}

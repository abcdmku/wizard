import type { ReactElement } from 'react'
import type { RunSummary, WizardInfo } from '../wire'
import { clock, runTag, span } from './format'
import { Go, type Route } from './nav'

const todo = (count: number): string => `${count} to do`

function RunLink(props: {
  readonly run: RunSummary
  readonly active: boolean
  readonly now: number
}) {
  const { run } = props
  const waiting = run.waiting > 0
  return (
    <Go className="nav-item nav-run" to={{ page: 'run', id: run.id }} current={props.active}>
      <span className="dot" data-status={run.status} aria-hidden="true" />
      <span className="nav-main">
        <span className="nav-name">
          {run.wizard} <span className="run-tag">{runTag(run.id)}</span>
        </span>
        <span className="nav-sub">
          {run.status}
          {waiting && (
            <>
              {' · '}
              <span className="nav-todo">{todo(run.waiting)}</span>
            </>
          )}
        </span>
      </span>
      {waiting && (
        <span
          className="count"
          aria-hidden="true"
          title="Forms, events, service calls or timers waiting for you"
        >
          {todo(run.waiting)}
        </span>
      )}
      <span className="nav-age" title={`Started ${clock(run.createdAt)}`}>
        {span(props.now - run.createdAt)}
      </span>
    </Go>
  )
}

function Group(props: {
  readonly title: string
  readonly empty: string | undefined
  readonly children: ReactElement[]
}) {
  return (
    <div className="side-group" data-empty={props.children.length === 0 || undefined}>
      <h2>{props.title}</h2>
      {props.children}
      {props.children.length === 0 && <p className="side-empty">{props.empty}</p>}
    </div>
  )
}

/** The wizards and the runs: a sidebar in a wide frame, one row of chips in a narrow one. */
export function Side(props: {
  readonly wizards: readonly WizardInfo[]
  readonly runs: readonly RunSummary[]
  readonly route: Route
  readonly now: number
}): ReactElement {
  const { route } = props
  return (
    <nav className="side" aria-label="Wizards and runs">
      <Group title="Wizards" empty="No wizard loaded.">
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
      <Group title="Runs" empty="No runs yet. Start one from a wizard.">
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

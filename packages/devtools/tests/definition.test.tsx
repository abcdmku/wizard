import { defineWizard } from '@openwizard/core'
import { inspect } from '@openwizard/core/inspect'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { StepInspector, WizardGraph } from '../src'

afterEach(cleanup)

const fact = (root: HTMLElement, key: string) =>
  [...root.querySelectorAll<HTMLElement>('.owd-kv')]
    .find((row) => row.querySelector('.owd-kv-key')?.textContent === key)
    ?.querySelector('.owd-kv-value')?.textContent

const wizard = defineWizard(
  { name: 'batch-inspection', context: z.object({ ids: z.array(z.number()) }) },
  ({ step, steps }) => {
    const doubled = step({
      each: ({ context }) => context.ids,
      concurrency: 2,
      run: ({ item }) => item * 2,
      fallback: 'recover',
    })
    return steps(
      {
        doubled,
        join: step({ needs: { values: doubled }, run: ({ needs }) => needs.values.length }),
        recover: step({ run: () => 0 }),
        delay: step({ sleep: '1m', next: 'join' }),
      },
      { start: ['doubled', 'delay'] },
    )
  },
)

it('draws data joins and fallback paths, and shows map and sleep facts in the inspector', async () => {
  const graph = inspect(wizard)
  const run = wizard.create({ ids: [1, 2] })
  const view = render(<WizardGraph graph={graph} />)
  await waitFor(
    () =>
      // A renamed need keeps its label; `needs doubled` on an edge from `doubled` would repeat it.
      expect(view.container.querySelector('.owd-edge-label[data-kind="needs"]')?.textContent).toBe(
        'needs values',
      ),
    // The first layout can take longer than the default second on a slow CI host.
    { timeout: 10_000 },
  )
  expect(view.container.querySelector('.owd-edge-label[data-kind="fallback"]')?.textContent).toBe(
    'fallback',
  )
  expect(screen.getByText('each (2 concurrent)')).toBeTruthy()
  expect(screen.getByText('sleep 1m')).toBeTruthy()

  view.rerender(<StepInspector source={run} step="doubled" graph={graph} />)
  expect(fact(view.container, 'each')).toBe('{"concurrency":2}')
  expect(fact(view.container, 'fallback')).toBe('recover')
  view.rerender(<StepInspector source={run} step="delay" graph={graph} />)
  expect(fact(view.container, 'sleep')).toBe('1m')
  view.rerender(<StepInspector source={run} step="join" graph={graph} />)
  expect(fact(view.container, 'needs')).toBe('{"values":{"kind":"all","steps":["doubled"]}}')
  run.dispose()
}, 15_000)

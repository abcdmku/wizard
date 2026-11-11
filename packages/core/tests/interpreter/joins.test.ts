/**
 * D5: a join whose needs can no longer complete never hangs the run: once nothing else can move,
 * it fails `DEPS_UNREACHABLE` (naming the producers and the routing step that went elsewhere), and
 * `skip(join)` lets the run finish.
 */
import { describe, expect, it } from 'vitest'
import { flow, needAll, needOptional, routeStep, runStep } from '../helpers/fixtures'
import { e2e } from '../wizard/e2e/harness'

describe('branch joins', () => {
  it('completes a join with optional needs when a declared branch was not taken', async () => {
    const def = flow({
      start: 'decide',
      steps: {
        decide: {
          ...routeStep({ decide: () => 'a' }),
          next: { kind: 'dynamic', targets: ['a', 'b'] },
        },
        a: runStep({ run: () => 'A', next: 'join' }),
        b: runStep({ run: () => 'B', next: 'join' }),
        join: runStep({ run: () => 'joined', needs: needOptional('a', 'b') }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.rec('b')).toMatchObject({ status: 'skipped', skipReason: 'not-taken' })
    expect(t.rec('join')).toMatchObject({ status: 'done', output: 'joined' })
    expect(t.run.getState()).toMatchObject({ status: 'done', output: 'joined' })
  })

  it('fails an unreachable join when a dynamic route did not declare its branches', async () => {
    const def = flow({
      start: 'decide',
      steps: {
        decide: routeStep({ decide: () => 'a' }),
        a: runStep({ run: () => 'A', next: 'join' }),
        b: runStep({ run: () => 'B', next: 'join' }),
        join: runStep({ run: () => 'joined', needs: needAll('a', 'b') }),
      },
    })
    const t = e2e(def)
    await t.run.start()
    expect(t.run.getState().status).toBe('halted')
    expect(t.rec('join').error).toMatchObject({
      kind: 'guard',
      code: 'DEPS_UNREACHABLE',
      message: "step 'join' waits on 'b', which can no longer complete",
    })

    await t.run.skip('join')
    expect(t.run.getState().status).toBe('done')
    expect(t.run.getState().output).toBeUndefined()
  })
})

/** A remote mapped child requires a numeric input index and retains the child's command types. */
import { describe, expectTypeOf, it } from 'vitest'
import type { MirrorChild, MirrorResult } from '../../src/mirror/commands'
import { createMirror } from '../../src/mirror/create-mirror'
import {
  type ChildSummary,
  defineProjection,
  type ProjectionOutput,
} from '../../src/projection/define-projection'
import { type review, reviews, type reviewsClient } from '../mirror/mapped-fixture'

describe('mapped mirror child types', () => {
  it('requires an index for mapped children and permits mapped parent retries', () => {
    const mirror = createMirror<typeof reviewsClient>({})
    const child = mirror.child('batch', 0)
    expectTypeOf(child).toEqualTypeOf<MirrorChild<typeof review>>()
    expectTypeOf(child.setInput('form', { note: 'hello' })).toEqualTypeOf<Promise<MirrorResult>>()
    expectTypeOf(child.send('approved', true)).toEqualTypeOf<Promise<MirrorResult>>()
    expectTypeOf(mirror.retry('batch')).toEqualTypeOf<Promise<MirrorResult>>()
    expectTypeOf(mirror.getSnapshot()?.steps.batch.child?.[0]?.steps.form.input).toEqualTypeOf<
      { note?: string } | undefined
    >()
    type Children = NonNullable<ProjectionOutput<typeof reviewsClient>['steps']['batch']['child']>
    expectTypeOf<Extract<Children[number], null>>().toEqualTypeOf<null>()
    expectTypeOf<Extract<Children[number], undefined>>().toEqualTypeOf<never>()
    const summaries = defineProjection(reviews, { expose: { steps: { batch: { child: true } } } })
    expectTypeOf<ProjectionOutput<typeof summaries>['steps']['batch']['child']>().toEqualTypeOf<
      readonly (ChildSummary | null)[] | undefined
    >()
    // @ts-expect-error mapped children require an input index
    mirror.child('batch')
    // @ts-expect-error remote selectors use numeric indices
    mirror.child('batch', 'left')
    // @ts-expect-error payload remains typed by the child event
    child.send('approved', 'yes')
    // @ts-expect-error child commands reject parent step ids
    child.setInput('batch', {})
  })
})

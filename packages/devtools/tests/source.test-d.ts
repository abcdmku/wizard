import { defineWizard, type Run } from '@openwizard/core'
import type { Mirror } from '@openwizard/core/mirror'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { type DevtoolsSource, isRunSource, type MirrorSource, type RunSource } from '../src'
import type { pipeline, pipelineClient } from './fixture'
import type { mappedParent, mappedProjection, numericChild } from './mapped-fixture'

expectTypeOf<Run<typeof pipeline>>().toExtend<RunSource>()
expectTypeOf<Mirror<typeof pipelineClient>>().toExtend<MirrorSource>()

const leaf = defineWizard({ name: 'leaf', context: z.object({}) }, ({ step, steps }) =>
  steps({ done: step({ run: () => 'done' }) }),
)
expectTypeOf<Run<typeof leaf>>().toExtend<RunSource>()
expectTypeOf<Run<typeof numericChild>>().toExtend<RunSource>()
expectTypeOf<Run<typeof mappedParent>>().toExtend<RunSource>()
expectTypeOf<Mirror<typeof mappedProjection>>().toExtend<MirrorSource>()

declare const source: DevtoolsSource
if (isRunSource(source)) {
  expectTypeOf(source).toEqualTypeOf<RunSource>()
  expectTypeOf(source.getState().status).toExtend<string>()
} else {
  expectTypeOf(source).toEqualTypeOf<MirrorSource>()
}

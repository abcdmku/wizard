import type {
  Ctx,
  DepsOf,
  ErrorOf,
  EventType,
  InputOf,
  PayloadOf,
  ProjectionScope,
  WizardOutput,
} from '@openwizard/core'
import { describe, expectTypeOf, it } from 'vitest'
import type {
  ApplicantViewer,
  BusinessProfileInput,
  IntakeContext,
  IntakeResult,
  ReviewerViewer,
  RiskCompletedEvent,
} from '../../shared/index.js'
import type { IntakeFlow } from './flow.js'
import type { IntakeDeps } from './ports.js'
import type { applicantProjection, reviewerProjection } from './projections.js'

describe('intake workflow inference', () => {
  it('infers context, dependencies, view input, output, events, scope, and errors', () => {
    expectTypeOf<Ctx<IntakeFlow>>().toEqualTypeOf<IntakeContext>()
    expectTypeOf<DepsOf<IntakeFlow>>().toEqualTypeOf<IntakeDeps>()
    expectTypeOf<InputOf<IntakeFlow, 'businessProfile'>>().toEqualTypeOf<BusinessProfileInput>()
    expectTypeOf<WizardOutput<IntakeFlow>>().toMatchTypeOf<IntakeResult>()
    expectTypeOf<IntakeResult>().toMatchTypeOf<WizardOutput<IntakeFlow>>()
    expectTypeOf<EventType<IntakeFlow>>().toEqualTypeOf<'risk.completed' | 'review.decided'>()
    expectTypeOf<PayloadOf<IntakeFlow, 'risk.completed'>>().toEqualTypeOf<RiskCompletedEvent>()
    expectTypeOf<ProjectionScope<typeof applicantProjection>>().toEqualTypeOf<ApplicantViewer>()
    expectTypeOf<ProjectionScope<typeof reviewerProjection>>().toEqualTypeOf<ReviewerViewer>()
    expectTypeOf<ErrorOf<IntakeFlow, 'queueRisk'>>().toEqualTypeOf<never>()
  })
})

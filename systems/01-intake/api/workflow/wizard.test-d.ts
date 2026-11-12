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
import type { IntakeDeps } from './ports.js'
import type { applicantProjection, reviewerProjection } from './projections.js'
import type { IntakeWizard } from './wizard.js'

describe('intake workflow inference', () => {
  it('infers context, dependencies, view input, output, events, scope, and errors', () => {
    expectTypeOf<Ctx<IntakeWizard>>().toEqualTypeOf<IntakeContext>()
    expectTypeOf<DepsOf<IntakeWizard>>().toEqualTypeOf<IntakeDeps>()
    expectTypeOf<InputOf<IntakeWizard, 'businessProfile'>>().toEqualTypeOf<BusinessProfileInput>()
    expectTypeOf<WizardOutput<IntakeWizard>>().toMatchTypeOf<IntakeResult>()
    expectTypeOf<IntakeResult>().toMatchTypeOf<WizardOutput<IntakeWizard>>()
    expectTypeOf<EventType<IntakeWizard>>().toEqualTypeOf<'risk.completed' | 'review.decided'>()
    expectTypeOf<PayloadOf<IntakeWizard, 'risk.completed'>>().toEqualTypeOf<RiskCompletedEvent>()
    expectTypeOf<ProjectionScope<typeof applicantProjection>>().toEqualTypeOf<ApplicantViewer>()
    expectTypeOf<ProjectionScope<typeof reviewerProjection>>().toEqualTypeOf<ReviewerViewer>()
    expectTypeOf<ErrorOf<IntakeWizard, 'queueRisk'>>().toEqualTypeOf<never>()
  })
})

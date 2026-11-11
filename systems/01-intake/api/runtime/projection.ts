import type { DurableRunHost } from '@openwizard/durable'
import type { ApplicationView, Viewer } from '../../shared/index.js'
import type { ApplicationRecord } from '../db/index.js'
import { applicantProjection, type IntakeWizard, reviewerProjection } from '../workflow/index.js'

export type ApplicationProjectionResult =
  | { readonly ok: false; readonly code: 'FORBIDDEN'; readonly message: string }
  | { readonly ok: true; readonly application: ApplicationView }

type ApplicationProjectionHost = Pick<DurableRunHost<IntakeWizard>, 'run' | 'version'>

export function projectApplication(
  host: ApplicationProjectionHost,
  application: ApplicationRecord,
  viewer: Viewer,
): ApplicationProjectionResult {
  const projection =
    viewer.role === 'applicant'
      ? host.run.project(applicantProjection, viewer)
      : host.run.project(reviewerProjection, viewer)
  if (projection.access === 'forbidden') {
    return { ok: false, code: 'FORBIDDEN', message: 'projection is not authorized' }
  }
  const version = host.version
  return {
    ok: true,
    application: {
      id: application.id,
      applicantName: projection.applicantName,
      createdAt: application.createdAt.toISOString(),
      updatedAt: application.updatedAt.toISOString(),
      status: projection.status,
      workflow: {
        ...projection.workflow,
        epoch: version.epoch,
        seq: version.seq,
      },
    },
  }
}

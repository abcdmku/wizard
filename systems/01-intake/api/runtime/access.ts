import type { Viewer } from '../../shared/index.js'
import type { ApplicationRecord } from '../db/index.js'
import type { RuntimeFailure } from './types.js'

export function canAccessApplication(viewer: Viewer, application: ApplicationRecord): boolean {
  if (viewer.tenantId !== application.tenantId) return false
  return viewer.role === 'reviewer' || viewer.applicantId === application.applicantId
}

export function notFound(applicationId: string): RuntimeFailure {
  return {
    ok: false,
    code: 'NOT_FOUND',
    message: `application '${applicationId}' was not found`,
  }
}

export function forbidden(): RuntimeFailure {
  return { ok: false, code: 'FORBIDDEN', message: 'command is not authorized' }
}

export function disposed(): RuntimeFailure {
  return { ok: false, code: 'DISPOSED', message: 'intake runtime is shut down' }
}

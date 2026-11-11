import type { ConsentInput, PrefillResult } from '../shared/index.js'
import type { IntakeDatabase } from './db/index.js'
import type { IntakeDeps } from './workflow/index.js'

export function createIntakeDeps(
  database: IntakeDatabase,
  now: () => Date = () => new Date(),
): IntakeDeps {
  return {
    async prefill(applicationId, consent) {
      const application = await requireApplication(database, applicationId)
      return demoPrefill(application.applicantName, applicationId, consent, now())
    },
    async enqueueRisk(applicationId, input, idempotencyKey) {
      const application = await requireApplication(database, applicationId)
      const job = await database.riskJobs.enqueue({
        applicationId,
        tenantId: application.tenantId,
        fingerprint: idempotencyKey,
        input,
      })
      return job.id
    },
  }
}

function demoPrefill(
  applicantName: string,
  applicationId: string,
  consent: ConsentInput,
  fetchedAt: Date,
): PrefillResult {
  const suffix =
    applicationId
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-8)
      .toUpperCase() || 'DEMO'
  const legalName = `${applicantName} Works Inc`
  return {
    registryProfile: {
      legalName,
      legalStructure: 'incorporated',
      registrationNumber: `IL-${suffix}`,
      postalCode: '60601',
      verified: consent.consentToRegistry,
    },
    ...(consent.consentToPreviousApplication
      ? {
          previousApplication: {
            legalName,
            requestedAmount: 25_000,
            submittedAt: new Date(fetchedAt.getTime() - 365 * 24 * 60 * 60 * 1_000).toISOString(),
          },
        }
      : {}),
    fetchedAt: fetchedAt.toISOString(),
  }
}

async function requireApplication(database: IntakeDatabase, applicationId: string) {
  const application = await database.applications.getById(applicationId)
  if (application === null) throw new Error(`application '${applicationId}' was not found`)
  return application
}

import { beforeAll, describe, expect, it } from 'vitest'
import {
  ApiErrorSchema,
  ApplicationViewSchema,
  CommandResponseSchema,
  ReviewerQueueSchema,
} from '../shared/api-contract'
import { ApplicationStreamEventSchema } from '../shared/sse'
import {
  applicantToken,
  baseUrl,
  body,
  commandBody,
  createFixture,
  type Fixture,
  request,
  reviewerToken,
  tenant,
  westApplicantToken,
  westReviewerToken,
  westTenant,
} from './support'

let fixture: Fixture
let westFixture: Fixture

describe('intake REST, SSE, and authorization contract', () => {
  beforeAll(async () => {
    fixture = await createFixture()
    westFixture = await createFixture({
      applicantToken: westApplicantToken,
      reviewerToken: westReviewerToken,
      tenant: westTenant,
    })
  })

  it('reports a ready Postgres-backed API', async () => {
    const response = await fetch(`${baseUrl}/health`)
    expect(response.status).toBe(200)
    expect(await body(response)).not.toHaveProperty('databaseError')
  })

  it('rejects missing, malformed, and role-incompatible credentials', async () => {
    const missing = await fetch(`${baseUrl}/api/applications/${fixture.id}`)
    expect(missing.status).toBe(401)
    const malformed = await request(`/api/applications/${fixture.id}`, {}, 'Bearer')
    expect(malformed.status).toBe(401)
    const reviewerOnApplicant = await request(`/api/applications/${fixture.id}`, {}, reviewerToken)
    expect(reviewerOnApplicant.status).toBe(403)
    const applicantOnReviewer = await fetch(`${baseUrl}/api/reviewer/applications`)
    expect(applicantOnReviewer.status).toBe(401)

    const malformedJson = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: '{"type":',
    })
    expect(malformedJson.status).toBe(400)
    expect(ApiErrorSchema.parse(await malformedJson.json()).ok).toBe(false)
  })

  it('keeps application and reviewer reads tenant-scoped', async () => {
    const wrongTenant = await request(
      `/api/applications/${fixture.id}`,
      {},
      applicantToken,
      'other-tenant',
    )
    expect(wrongTenant.status).toBe(403)
    const wrongReviewerTenant = await request(
      '/api/reviewer/applications',
      {},
      reviewerToken,
      'other-tenant',
    )
    expect(wrongReviewerTenant.status).toBe(403)

    const foreignApplicantRead = await request(
      `/api/applications/${westFixture.id}`,
      {},
      applicantToken,
      tenant,
    )
    expect(foreignApplicantRead.status).toBe(403)
    const foreignReviewerRead = await request(
      `/api/reviewer/applications/${westFixture.id}`,
      {},
      reviewerToken,
      tenant,
    )
    expect(foreignReviewerRead.status).toBe(403)
    const foreignCommand = await request(
      `/api/applications/${westFixture.id}/commands`,
      {
        method: 'POST',
        body: JSON.stringify(commandBody(westFixture, `foreign-${Date.now()}`, 'start')),
      },
      applicantToken,
      tenant,
    )
    expect(foreignCommand.status).toBe(403)

    const canonicalFromWest = await request(
      `/api/applications/${fixture.id}`,
      {},
      westApplicantToken,
      westTenant,
    )
    expect(canonicalFromWest.status).toBe(403)
    const westQueue = ReviewerQueueSchema.parse(
      await body(await request('/api/reviewer/applications', {}, westReviewerToken, westTenant)),
    )
    expect(westQueue.applications.map((application) => application.id)).toContain(westFixture.id)
    expect(westQueue.applications.map((application) => application.id)).not.toContain(fixture.id)
  })

  it('serves parseable ordered projected SSE snapshots', async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2_000)
    try {
      const response = await request(`/api/applications/${fixture.id}/events`, {
        signal: controller.signal,
        headers: { accept: 'text/event-stream' },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/event-stream')
      const reader = response.body?.getReader()
      if (!reader) throw new Error('SSE response did not have a body')
      const first = await reader.read()
      const text = new TextDecoder().decode(first.value)
      const payload = text
        .split(/\r?\n/)
        .find((line) => line.startsWith('data:'))
        ?.slice(5)
        .trim()
      expect(payload).toBeTruthy()
      expect(ApplicationStreamEventSchema.safeParse(JSON.parse(payload ?? '')).success).toBe(true)
      await reader.cancel()
    } finally {
      clearTimeout(timer)
    }
  })

  it('replays an idempotent command and rejects stale or conflicting writes', async () => {
    const commandId = `contract-${Date.now()}`
    const requestBody = commandBody(fixture, commandId, 'setInput', {
      step: 'consent',
      patch: {
        consentToPreviousApplication: false,
        consentToRegistry: true,
        contactEmail: 'contract@example.test',
      },
    })
    const accepted = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
    expect(accepted.status).toBe(200)
    const first = CommandResponseSchema.parse(await accepted.json())
    expect(first.ok).toBe(true)
    const replay = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: JSON.stringify(requestBody),
    })
    expect(replay.status).toBe(200)
    expect(CommandResponseSchema.parse(await replay.json()).replayed).toBe(true)
    const conflicting = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        ...requestBody,
        patch: {
          consentToPreviousApplication: false,
          consentToRegistry: true,
          contactEmail: 'different@example.test',
        },
      }),
    })
    expect(conflicting.status).toBe(409)
    expect(CommandResponseSchema.parse(await conflicting.json()).code).toBe('DEDUPLICATE_CONFLICT')
    const stale = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: JSON.stringify({
        commandId: `stale-${Date.now()}`,
        type: 'next',
        expectedVersion: { epoch: 0, seq: 0 },
      }),
    })
    expect(stale.status).toBe(409)
    expect(CommandResponseSchema.parse(await stale.json())).toMatchObject({
      ok: false,
      code: 'CAS_CONFLICT',
    })
  })

  it('does not leak private fields through applicant or reviewer projections', async () => {
    const applicant = await body(await request(`/api/applications/${fixture.id}`))
    const reviewer = await body(
      await request(`/api/reviewer/applications/${fixture.id}`, {}, reviewerToken),
    )
    const serialized = JSON.stringify({ applicant, reviewer }).toLowerCase()
    for (const secret of ['ssn', 'taxid', 'rawdocument', 'privatenote', 'riskproviderpayload']) {
      expect(serialized).not.toContain(secret)
    }
    const parsed = ApplicationViewSchema.safeParse(reviewer)
    expect(parsed.success).toBe(true)
  })
})

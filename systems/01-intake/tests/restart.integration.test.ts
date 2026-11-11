import { beforeAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { DEMO_APPLICATION_ID } from '../api/application-service'
import { type ApplicationView, CommandResponseSchema } from '../shared/api-contract'
import {
  advanceApplicantToBusinessProfile,
  advanceStandardApplicantToRisk,
  applicantToken,
  command,
  commandBody,
  createFixture,
  type Fixture,
  request,
  reviewerToken,
  view,
  waitFor,
} from './support'

let fixture: Fixture
const apiUrl = process.env.INTAKE_API_URL ?? 'http://127.0.0.1:4310'
const workerUrl = process.env.INTAKE_WORKER_URL ?? 'http://127.0.0.1:4320'
const WorkerHealthSchema = z.object({
  workerId: z.string(),
  claimed: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
})

async function refresh(): Promise<void> {
  fixture.view = await view(await request(`/api/applications/${fixture.id}`))
}

async function tryRefresh(): Promise<boolean> {
  const response = await request(`/api/applications/${fixture.id}`)
  if (!response.ok) return false
  fixture.view = await view(response)
  return true
}

async function next(label: string): Promise<void> {
  const result = await command(fixture, `next-${label}-${Date.now()}`, 'next')
  expect(result.ok, JSON.stringify({ result, current: fixture.view.workflow.current })).toBe(true)
  await refresh()
}

async function setInput(step: string, patch: Record<string, unknown>): Promise<void> {
  const result = await command(fixture, `input-${step}-${Date.now()}`, 'setInput', { step, patch })
  expect(result.ok, JSON.stringify({ result, current: fixture.view.workflow.current })).toBe(true)
  await refresh()
}

async function waitForCurrent(step: string): Promise<void> {
  await waitFor(async () => {
    await refresh()
    return fixture.view.workflow.current === step
  })
}

async function restartService(service: 'api' | 'review-worker', healthUrl: string): Promise<void> {
  const { execFile } = await import('node:child_process')
  await new Promise<void>((resolve, reject) => {
    execFile('docker', ['compose', 'restart', service], { cwd: process.cwd() }, (error) =>
      error ? reject(error) : resolve(),
    )
  })
  await waitFor(async () => {
    try {
      return (await fetch(healthUrl)).ok
    } catch {
      return false
    }
  }, 20_000)
}

async function restartApi(): Promise<void> {
  await restartService('api', `${apiUrl}/health`)
}

async function workerHealth(): Promise<z.infer<typeof WorkerHealthSchema>> {
  const response = await fetch(`${workerUrl}/health`)
  if (!response.ok) throw new Error(`worker health failed: ${response.status}`)
  return WorkerHealthSchema.parse(await response.json())
}

async function restartWorker(): Promise<void> {
  const before = await workerHealth()
  await restartService('review-worker', `${workerUrl}/health`)
  await waitFor(async () => {
    try {
      return (await workerHealth()).workerId !== before.workerId
    } catch {
      return false
    }
  }, 20_000)
}

async function waitForStableReviewerView(applicationId: string): Promise<ApplicationView> {
  let lastVersion = ''
  let stable: ApplicationView | undefined
  await waitFor(async () => {
    const response = await request(`/api/reviewer/applications/${applicationId}`, {}, reviewerToken)
    if (!response.ok) return false
    const candidate = await view(response)
    if (candidate.status !== 'awaiting-reviewer') return false
    const version = `${candidate.workflow.epoch}:${candidate.workflow.seq}`
    if (version === lastVersion) {
      stable = candidate
      return true
    }
    lastVersion = version
    return false
  }, 20_000)
  if (stable === undefined) throw new Error('reviewer projection did not stabilize after restart')
  return stable
}

describe('intake restart and recovery contract', () => {
  beforeAll(async () => {
    fixture = await createFixture()
  })

  it('replays a deduplicated command after API restart before running the risk job', async () => {
    await advanceApplicantToBusinessProfile(fixture)
    const replayBody = commandBody(fixture, `restart-dedupe-${Date.now()}`, 'setInput', {
      step: 'businessProfile',
      patch: {
        legalName: 'Restart Recovery LLC',
        registrationNumber: 'RR-001',
        legalStructure: 'incorporated',
        annualRevenue: 250_000,
        requestedAmount: 50_000,
        tradingMonths: 48,
        employeeCount: 8,
        postalCode: '60601',
        experiencedHardship: false,
      },
    })
    const appliedResponse = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: JSON.stringify(replayBody),
    })
    const applied = CommandResponseSchema.parse(await appliedResponse.json())
    expect(appliedResponse.status).toBe(200)
    expect(applied).toMatchObject({ ok: true, replayed: false })
    if (applied.version === undefined) throw new Error('applied command did not return a version')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await restartApi()
    const replayedResponse = await request(`/api/applications/${fixture.id}/commands`, {
      method: 'POST',
      body: JSON.stringify(replayBody),
    })
    const replayed = CommandResponseSchema.parse(await replayedResponse.json())
    expect(replayedResponse.status).toBe(200)
    expect(replayed).toMatchObject({ ok: true, replayed: true, version: applied.version })
    await refresh()
    await next('owners')
    await waitForCurrent('beneficialOwners')
    await setInput('beneficialOwners', {
      owners: [{ id: 'restart-owner', name: 'Ada Lovelace', ownershipPercent: 100 }],
    })
    await next('eligibility')
    await waitForCurrent('standardFinancials')
    await setInput('standardFinancials', {
      annualExpenses: 120_000,
      cashOnHand: 30_000,
      fiscalYearEnd: '2025-12-31',
    })
    await next('financials')
    await waitForCurrent('documents')
    await setInput('documents', {
      documents: [
        {
          id: 'restart-doc',
          name: 'financials.pdf',
          category: 'financial',
          sizeBytes: 1024,
          uploadedAt: new Date().toISOString(),
        },
      ],
    })
    await next('documents')
    await waitForCurrent('review')
    await setInput('review', { confirmed: true, signatureName: 'Ada Lovelace' })
    const started = Date.now()
    await next('review')
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    await restartApi()
    await waitFor(async () => {
      if (!(await tryRefresh())) return false
      return ['approved', 'rejected', 'awaiting-reviewer'].includes(fixture.view.status)
    }, 20_000)
    expect(Date.now() - started).toBeGreaterThanOrEqual(4_500)
    expect(
      (await view(await request(`/api/applications/${fixture.id}`, {}, applicantToken))).id,
    ).toBe(fixture.id)
  })

  it('reclaims a risk job after a worker restart without a duplicate result', async () => {
    fixture = await createFixture()
    const workerBefore = await workerHealth()
    await advanceStandardApplicantToRisk(fixture)
    await waitFor(async () => {
      const current = await workerHealth()
      return current.claimed > workerBefore.claimed && current.completed === workerBefore.completed
    }, 10_000)
    await new Promise((resolve) => setTimeout(resolve, 500))
    const active = await workerHealth()
    expect(active.claimed).toBeGreaterThan(workerBefore.claimed)
    expect(active.completed).toBe(workerBefore.completed)
    await restartWorker()
    await waitFor(async () => {
      await refresh()
      return fixture.view.status === 'approved'
    }, 20_000)
    const settledSeq = fixture.view.workflow.seq
    await new Promise((resolve) => setTimeout(resolve, 750))
    await refresh()
    expect(fixture.view.status).toBe('approved')
    expect(fixture.view.workflow.seq).toBe(settledSeq)
    expect((await workerHealth()).completed).toBeGreaterThanOrEqual(1)
  })

  it('accepts a reviewer decision after an API restart during manual review', async () => {
    expect(
      (await request('/api/demo/reset', { method: 'POST', body: '{}' }, reviewerToken)).status,
    ).toBe(200)
    expect(
      (await request('/api/demo/seed', { method: 'POST', body: '{}' }, reviewerToken)).status,
    ).toBe(200)
    const before = await view(
      await request(`/api/reviewer/applications/${DEMO_APPLICATION_ID}`, {}, reviewerToken),
    )
    expect(before.status).toBe('awaiting-reviewer')
    await restartApi()
    const resumed = await waitForStableReviewerView(DEMO_APPLICATION_ID)
    expect(resumed.workflow.epoch).toBeGreaterThanOrEqual(before.workflow.epoch)
    const decision = await request(
      `/api/reviewer/applications/${DEMO_APPLICATION_ID}/commands`,
      {
        method: 'POST',
        body: JSON.stringify({
          commandId: `manual-restart-${Date.now()}`,
          expectedVersion: { epoch: resumed.workflow.epoch, seq: resumed.workflow.seq },
          type: 'approve',
          reason: 'Manual review survived the API restart',
        }),
      },
      reviewerToken,
    )
    expect(decision.status).toBe(200)
    expect(CommandResponseSchema.parse(await decision.json())).toMatchObject({ ok: true })
    await waitFor(async () => {
      const application = await view(
        await request(`/api/reviewer/applications/${DEMO_APPLICATION_ID}`, {}, reviewerToken),
      )
      return application.status === 'approved'
    })
    expect(
      (await request('/api/demo/reset', { method: 'POST', body: '{}' }, reviewerToken)).status,
    ).toBe(200)
  })
})

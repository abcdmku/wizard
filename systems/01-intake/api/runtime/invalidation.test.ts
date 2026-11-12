import type { Command } from '@openwizard/core'
import {
  createDurableRun,
  createMemoryDurableStore,
  type DurableCommandResult,
} from '@openwizard/durable'
import { describe, expect, it } from 'vitest'
import type { IntakeContext, PrefillResult } from '../../shared/index.js'
import type { ApplicationRecord } from '../db/index.js'
import { type IntakeDeps, type IntakeWizard, intakeWizard } from '../workflow/index.js'
import { invalidateAfterDraftMutation } from './invalidation.js'
import { projectApplication } from './projection.js'

const context: IntakeContext = {
  applicationId: 'invalidation-app',
  tenantId: 'tenant-1',
  applicantId: 'applicant-1',
  applicantName: 'Ada Lovelace',
  changeRequestCount: 0,
}

const prefill: PrefillResult = {
  registryProfile: {
    legalName: 'Analytical Engines Inc',
    registrationNumber: 'REG-1843',
    legalStructure: 'incorporated',
    postalCode: '60601',
    verified: true,
  },
  fetchedAt: '2026-08-23T10:00:00.000Z',
}

const deps: IntakeDeps = {
  prefill: async () => prefill,
  enqueueRisk: async (_applicationId, _input, idempotencyKey) => idempotencyKey,
}

type DraftMutation = Extract<Command<IntakeWizard>, { readonly type: 'setInput' | 'resetInput' }>

describe('runtime downstream invalidation', () => {
  it('skips idle downstream work, then invalidates completed work after a back edit', async () => {
    const opened = await createDurableRun(intakeWizard, {
      context,
      deps,
      store: createMemoryDurableStore(),
      key: 'intake:tenant-1:invalidation-app',
      ownerId: 'runtime-test',
    })
    if (!opened.ok) throw new Error(`durable run did not open: ${opened.code}`)
    const { host } = opened
    await accepted(host.dispatch({ type: 'start' }, { commandId: 'start' }))

    const firstEdit: DraftMutation = {
      type: 'setInput',
      step: 'consent',
      patch: {
        consentToPreviousApplication: true,
        consentToRegistry: true,
        contactEmail: 'ada@example.test',
      },
    }
    await accepted(host.dispatch(firstEdit, { commandId: 'first-edit' }))
    await expect(
      invalidateAfterDraftMutation(host, firstEdit, 'first-edit'),
    ).resolves.toBeUndefined()
    expect(host.run.getState().steps.prefill.status).toBe('idle')

    await accepted(host.dispatch({ type: 'next' }, { commandId: 'first-next' }))
    await host.run.awaitOutcome()
    expect(host.run.getState().current).toBe('businessProfile')
    expect(host.run.getState().steps.prefill.status).toBe('done')
    await accepted(host.dispatch({ type: 'back' }, { commandId: 'back-to-consent' }))

    const backEdit: DraftMutation = {
      type: 'setInput',
      step: 'consent',
      patch: { contactEmail: 'updated@example.test' },
    }
    await accepted(host.dispatch(backEdit, { commandId: 'back-edit' }))
    const invalidated = await invalidateAfterDraftMutation(host, backEdit, 'back-edit')
    expect(invalidated?.ok).toBe(true)
    expect(host.run.getState().steps.prefill.status).not.toBe('done')
    await host.dispose()
  })

  it('publishes the authoritative durable host version in projected views', async () => {
    const opened = await createDurableRun(intakeWizard, {
      context,
      deps,
      store: createMemoryDurableStore(),
      key: 'intake:tenant-1:projection-version-app',
      ownerId: 'projection-version-test',
    })
    if (!opened.ok) throw new Error(`durable run did not open: ${opened.code}`)
    const application: ApplicationRecord = {
      id: context.applicationId,
      tenantId: context.tenantId,
      applicantId: context.applicantId,
      applicantName: context.applicantName,
      createdAt: new Date('2026-08-23T10:00:00.000Z'),
      updatedAt: new Date('2026-08-23T10:00:00.000Z'),
      terminalAt: null,
    }
    const projected = projectApplication(
      { run: opened.host.run, version: { epoch: 7, seq: 99 } },
      application,
      { role: 'applicant', tenantId: context.tenantId, applicantId: context.applicantId },
    )
    expect(projected.ok).toBe(true)
    if (projected.ok) expect(projected.application.workflow).toMatchObject({ epoch: 7, seq: 99 })
    await opened.host.dispose()
  })
})

async function accepted(result: Promise<DurableCommandResult>): Promise<void> {
  const settled = await result
  expect(settled.ok).toBe(true)
  if (settled.ok) expect(settled.result.ok).toBe(true)
}

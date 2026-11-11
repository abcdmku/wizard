/** Principal-scoped projections stay request-local and pass scope through its boundary. */
import type { StandardSchemaV1 } from '@standard-schema/spec'
import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { WizardError } from '../../src/errors'
import { defineProjection } from '../../src/projection/define-projection'
import { createRun } from '../../src/wizard/create-wizard'
import { defineWizard } from '../../src/wizard/define-wizard'

interface Viewer {
  readonly tenantId: string
  readonly token: string
}
const flow = defineWizard(
  {
    name: 'scoped-projection',
    context: boundary.trusted<{
      readonly tenantId: string
      readonly secret: string
    }>(),
  },
  ({ step, steps }) =>
    steps({
      end: step({ run: ({ context }) => context.tenantId }),
    }),
)
const viewer = (token = 'principal-secret-token'): Viewer => ({ tenantId: 'tenant-a', token })
function asyncScope<T>(): StandardSchemaV1<T> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: async (value) => ({ value: value as T }),
    },
  }
}
function codeOf(action: () => unknown): string | undefined {
  try {
    action()
  } catch (error) {
    return error instanceof WizardError ? error.code : undefined
  }
  return undefined
}
describe('principal-scoped projections', () => {
  it('parses a supplied scope and gives the parsed value to select', () => {
    let parses = 0
    const projection = defineProjection(flow, {
      scope: boundary.parse<Viewer>((value) => {
        parses += 1
        if (typeof value !== 'object' || value === null || !('tenantId' in value)) {
          throw new Error('viewer required')
        }
        const candidate = value as Viewer
        return { tenantId: candidate.tenantId.toLowerCase(), token: candidate.token }
      }),
      select: ({ state, scope }) => ({
        visible: state.context.tenantId === scope.tenantId,
        seq: state.seq,
      }),
    })
    const run = createRun(flow, {
      context: { tenantId: 'tenant-a', secret: 'server-only' },
      instanceId: 'scoped-run',
    })
    expect(run.project(projection, { tenantId: 'TENANT-A', token: 't' })).toEqual({
      visible: true,
      seq: 0,
    })
    expect(parses).toBe(1)
    run.dispose()
  })
  it('rejects omitted, invalid, and asynchronously parsed scope values', () => {
    const projection = defineProjection(flow, {
      scope: boundary.parse<Viewer>((value) => {
        if (typeof value !== 'object' || value === null) throw new Error('viewer required')
        return value as Viewer
      }),
      select: ({ state }) => state.seq,
    })
    const asyncProjection = defineProjection(flow, {
      scope: asyncScope<Viewer>(),
      select: ({ state }) => state.seq,
    })
    const run = createRun(flow, {
      context: { tenantId: 'tenant-a', secret: 'server-only' },
    })
    const projectRaw = run.project as unknown as (...args: readonly unknown[]) => unknown
    expect(codeOf(() => projectRaw(projection))).toBe('DEFINITION_INVALID')
    expect(codeOf(() => projectRaw(projection, null))).toBe('BOUNDARY_REJECTED')
    expect(codeOf(() => projectRaw(asyncProjection, viewer()))).toBe('SYNC_VIOLATION')
    run.dispose()
  })
  it('does not retain scope in the run snapshot or event log', async () => {
    const projection = defineProjection(flow, {
      scope: boundary.trusted<Viewer>(),
      select: ({ state, scope }) => ({
        tenantMatch: state.context.tenantId === scope.tenantId,
      }),
    })
    const run = createRun(flow, {
      context: { tenantId: 'tenant-a', secret: 'server-only' },
    })
    const scope = viewer()
    expect(run.project(projection, scope)).toEqual({ tenantMatch: true })
    await run.start()
    expect(JSON.stringify(run.getSnapshot())).not.toContain(scope.token)
    expect(JSON.stringify(run.log())).not.toContain(scope.token)
    run.dispose()
  })
})

import type { CommitInput, Lease, Version } from '@openwizard/durable/store'
import {
  normalizeCommitInput,
  normalizeDedupeClaimInput,
  normalizeLease,
  normalizeTimerClaimInput,
  normalizeVersion,
  requireIdentifier,
} from '@openwizard/store-kit'
import { describe, expect, it } from 'vitest'

const lease: Lease = { key: 'run-1', ownerId: 'worker-a', fence: '1', expiresAt: 1_000 }
const v = (epoch: number, seq: number): Version => ({ epoch, seq })

/** Malformed input reaches a store from untyped callers, so the tests pass it the same way. */
const untyped = <Value>(value: unknown) => value as Value

function thrown(run: () => unknown): { name: string; code: string; message: string } {
  try {
    run()
  } catch (error) {
    const { name, code, message } = error as { name: string; code: string; message: string }
    return { name, code, message }
  }
  throw new Error('expected a DurableStoreError')
}

describe('requireIdentifier', () => {
  it('returns a non-empty string', () => {
    expect(requireIdentifier('run-1', 'key')).toBe('run-1')
  })

  it.each([[''], [undefined], [null], [7]])('rejects %j', (value) => {
    expect(thrown(() => requireIdentifier(value, 'key'))).toEqual({
      name: 'DurableStoreError',
      code: 'INVALID_ARGUMENT',
      message: 'key must be a non-empty string',
    })
  })
})

describe('normalizeLease', () => {
  it('copies the four lease fields and drops the rest', () => {
    const copy = normalizeLease(untyped({ ...lease, extra: true }))
    expect(copy).toEqual(lease)
    expect(copy).not.toBe(lease)
  })

  it.each([
    [null, 'lease must be an object'],
    ['lease', 'lease must be an object'],
    [{ ...lease, key: '' }, 'lease.key must be a non-empty string'],
    [{ ...lease, ownerId: 3 }, 'lease.ownerId must be a non-empty string'],
    [{ ...lease, fence: undefined }, 'lease.fence must be a non-empty string'],
    [{ ...lease, expiresAt: Number.POSITIVE_INFINITY }, 'lease.expiresAt must be a finite number'],
    [{ ...lease, expiresAt: '1000' }, 'lease.expiresAt must be a finite number'],
  ])('rejects %j', (value, message) => {
    expect(thrown(() => normalizeLease(untyped(value)))).toMatchObject({
      code: 'INVALID_ARGUMENT',
      message,
    })
  })
})

describe('normalizeVersion', () => {
  it('copies a version', () => {
    const version = v(2, 5)
    expect(normalizeVersion(version, 'expected')).toEqual(version)
    expect(normalizeVersion(version, 'expected')).not.toBe(version)
  })

  it.each([
    [null, 'expected must be an object'],
    [7, 'expected must be an object'],
    [{ epoch: -1, seq: 0 }, 'expected must contain non-negative safe integers'],
    [{ epoch: 0, seq: 1.5 }, 'expected must contain non-negative safe integers'],
    [{ epoch: 0, seq: 2 ** 53 }, 'expected must contain non-negative safe integers'],
    [{ epoch: '0', seq: 0 }, 'expected must contain non-negative safe integers'],
    [{ epoch: 0 }, 'expected must contain non-negative safe integers'],
  ])('rejects %j', (value, message) => {
    expect(thrown(() => normalizeVersion(untyped(value), 'expected'))).toMatchObject({
      code: 'INVALID_VERSION',
      message,
    })
  })
})

describe('normalizeCommitInput', () => {
  const record: CommitInput = { lease, expected: null, next: { value: { n: 1 }, version: v(0, 1) } }

  it('fills every optional field', () => {
    expect(normalizeCommitInput(record)).toEqual({
      lease,
      expected: null,
      next: { value: { n: 1 }, version: v(0, 1) },
      applyDedupe: undefined,
      completeDedupe: undefined,
      completeTimers: [],
    })
  })

  it('keeps the completion markers', () => {
    const normalized = normalizeCommitInput({
      lease,
      expected: v(0, 1),
      completeDedupe: { id: 'cmd-1', digest: 'd', claimId: 'dedupe:1', result: { ok: true } },
      completeTimers: [{ timerId: 't', dueAt: 5, expected: v(0, 1), claimId: 'timer:2' }],
    })
    expect(normalized.next).toBeUndefined()
    expect(normalized.completeDedupe).toEqual({
      id: 'cmd-1',
      digest: 'd',
      claimId: 'dedupe:1',
      result: { ok: true },
    })
    expect(normalized.completeTimers).toEqual([
      { timerId: 't', dueAt: 5, expected: v(0, 1), claimId: 'timer:2' },
    ])
  })

  it('rejects a commit that writes nothing', () => {
    expect(thrown(() => normalizeCommitInput({ lease, expected: null }))).toMatchObject({
      code: 'NOTHING_TO_COMMIT',
    })
  })

  it('checks the lease before anything else', () => {
    expect(
      thrown(() => normalizeCommitInput(untyped({ lease: null, expected: null }))),
    ).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'lease must be an object' })
  })

  it('rejects applyDedupe without a record', () => {
    expect(
      thrown(() =>
        normalizeCommitInput({
          lease,
          expected: null,
          applyDedupe: { id: 'cmd-1', claimId: 'dedupe:1' },
          completeDedupe: { id: 'cmd-1', digest: 'd', claimId: 'dedupe:1', result: null },
        }),
      ),
    ).toMatchObject({ code: 'INVALID_ARGUMENT', message: 'applyDedupe needs the next record' })
  })

  it.each([
    [null, 'INVALID_ARGUMENT', 'commit input must be an object'],
    [{ ...record, expected: { epoch: 0 } }, 'INVALID_VERSION', undefined],
    [{ ...record, next: null }, 'INVALID_ARGUMENT', 'next must be an object'],
    [{ ...record, next: { version: v(0, 1) } }, 'INVALID_ARGUMENT', 'next.value is required'],
    [{ ...record, next: { value: 1 } }, 'INVALID_VERSION', 'next.version is required'],
    [
      { ...record, next: { value: 1, version: v(0, -1) } },
      'INVALID_VERSION',
      'next.version must contain non-negative safe integers',
    ],
    [{ ...record, applyDedupe: null }, 'INVALID_ARGUMENT', 'dedupe application must be an object'],
    [
      { ...record, applyDedupe: { id: 'cmd-1', claimId: '' } },
      'INVALID_ARGUMENT',
      'dedupe claimId must be a non-empty string',
    ],
    [
      { ...record, completeDedupe: null },
      'INVALID_ARGUMENT',
      'dedupe completion must be an object',
    ],
    [
      { ...record, completeDedupe: { id: 'cmd-1', digest: '', claimId: 'dedupe:1' } },
      'INVALID_ARGUMENT',
      'dedupe digest must be a non-empty string',
    ],
    [{ ...record, completeTimers: [null] }, 'INVALID_ARGUMENT', 'timer completion must be an object'],
    [
      {
        ...record,
        completeTimers: [{ timerId: 't', dueAt: Number.NaN, expected: v(0, 0), claimId: 'c' }],
      },
      'INVALID_ARGUMENT',
      'dueAt must be a finite number',
    ],
    [
      { ...record, completeTimers: [{ timerId: 't', dueAt: 1, expected: null, claimId: 'c' }] },
      'INVALID_VERSION',
      'timer completion expected must be an object',
    ],
  ])('rejects %j', (value, code, message) => {
    const error = thrown(() => normalizeCommitInput(untyped(value)))
    expect(error.name).toBe('DurableStoreError')
    expect(error.code).toBe(code)
    if (message !== undefined) expect(error.message).toBe(message)
  })
})

describe('normalizeDedupeClaimInput', () => {
  it('omits the optional keys the caller did not pass', () => {
    expect(normalizeDedupeClaimInput({ lease, id: 'cmd-1', digest: 'd' })).toEqual({
      lease,
      id: 'cmd-1',
      digest: 'd',
    })
  })

  it('keeps expectedVersion and request', () => {
    const normalized = normalizeDedupeClaimInput({
      lease,
      id: 'cmd-1',
      digest: 'd',
      expectedVersion: v(0, 3),
      request: { n: 1 },
    })
    expect(normalized.expectedVersion).toEqual(v(0, 3))
    expect(normalized.request).toEqual({ n: 1 })
  })

  it.each([
    [null, 'INVALID_ARGUMENT'],
    [{ lease, id: '', digest: 'd' }, 'INVALID_ARGUMENT'],
    [{ lease, id: 'cmd-1' }, 'INVALID_ARGUMENT'],
    [{ lease, id: 'cmd-1', digest: 'd', expectedVersion: { epoch: 0, seq: -1 } }, 'INVALID_VERSION'],
  ])('rejects %j', (value, code) => {
    expect(thrown(() => normalizeDedupeClaimInput(untyped(value))).code).toBe(code)
  })
})

describe('normalizeTimerClaimInput', () => {
  it('copies a timer claim', () => {
    const input = { lease, timerId: 't', dueAt: 10, expected: v(0, 1) }
    expect(normalizeTimerClaimInput(input)).toEqual(input)
  })

  it.each([
    [null, 'INVALID_ARGUMENT'],
    [{ lease, timerId: '', dueAt: 10, expected: v(0, 1) }, 'INVALID_ARGUMENT'],
    [{ lease, timerId: 't', dueAt: Number.NaN, expected: v(0, 1) }, 'INVALID_ARGUMENT'],
    [{ lease, timerId: 't', dueAt: 10, expected: null }, 'INVALID_VERSION'],
  ])('rejects %j', (value, code) => {
    expect(thrown(() => normalizeTimerClaimInput(untyped(value))).code).toBe(code)
  })
})

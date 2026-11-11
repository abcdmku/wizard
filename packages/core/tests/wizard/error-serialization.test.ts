import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/authoring/boundary'
import { toSerializedError } from '../../src/interpreter/errors'
import { defineWizard } from '../../src/wizard/define-wizard'

function hostileError(reads: { code: number }): Error {
  const error = Object.assign(new Error(), { name: Symbol('name'), message: Symbol('message') })
  Object.defineProperty(error, 'code', {
    get: () => {
      reads.code += 1
      return reads.code === 1 ? 'E_HOSTILE' : Symbol('changed')
    },
  })
  return error
}

describe('hostile error serialization', () => {
  it('normalizes generic runtime errors to JSON-safe strings', () => {
    const errorReads = { code: 0 }
    const error = toSerializedError(hostileError(errorReads))
    const objectReads = { name: 0, code: 0 }
    const objectError = Object.defineProperties(
      { message: 'object failure' },
      {
        name: {
          get: () => (++objectReads.name === 1 ? 'ObjectError' : Symbol('changed')),
        },
        code: {
          get: () => (++objectReads.code === 1 ? 'E_OBJECT' : Symbol('changed')),
        },
      },
    )
    const serializedObject = toSerializedError(objectError)
    expect(errorReads.code).toBe(1)
    expect(objectReads).toEqual({ name: 1, code: 1 })
    expect(typeof error.name).toBe('string')
    expect(typeof error.message).toBe('string')
    expect(JSON.parse(JSON.stringify(error))).toEqual(error)
    expect(JSON.parse(JSON.stringify(serializedObject))).toEqual(serializedObject)
  })

  it('keeps a wait handler failure JSON-safe and resumable', async () => {
    const reads = { code: 0 }
    const wizard = defineWizard(
      {
        name: 'hostile-handler-error',
        context: boundary.trusted<{}>(),
        events: { event: boundary.trusted<null>() },
      },
      ({ step, steps }) =>
        steps({
          waiting: step({
            waitFor: {
              event: () => {
                throw hostileError(reads)
              },
            },
          }),
        }),
    )
    const run = wizard.create({})
    await run.start()
    await run.send('event', null)
    const snapshot = JSON.parse(JSON.stringify(run.getSnapshot())) as unknown
    const resumed = wizard.resume(snapshot)
    expect(resumed.getState().status).toBe('halted')
    expect(resumed.getState().failure).toEqual(run.getState().failure)
    expect(typeof resumed.getState().failure?.error.name).toBe('string')
    expect(typeof resumed.getState().failure?.error.message).toBe('string')
    expect(reads.code).toBe(1)
  })
})

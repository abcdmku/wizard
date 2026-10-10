import { describe, expect, it } from 'vitest'
import { parseDuration } from '../../src/authoring/duration'

describe('parseDuration', () => {
  it('passes numbers through (ms)', () => {
    expect(parseDuration(0)).toBe(0)
    expect(parseDuration(250)).toBe(250)
    expect(parseDuration(1.5)).toBe(1.5)
  })

  it('parses ms/s/m/h/d strings (integers and decimals)', () => {
    expect(parseDuration('250ms')).toBe(250)
    expect(parseDuration('15s')).toBe(15_000)
    expect(parseDuration('15m')).toBe(900_000)
    expect(parseDuration('2h')).toBe(7_200_000)
    expect(parseDuration('1d')).toBe(86_400_000)
    expect(parseDuration('1.5s')).toBe(1_500)
    expect(parseDuration('0ms')).toBe(0)
  })

  it('rejects negatives, non-finite numbers and malformed strings', () => {
    expect(() => parseDuration(-1)).toThrow(TypeError)
    expect(() => parseDuration(Number.NaN)).toThrow(TypeError)
    expect(() => parseDuration(Number.POSITIVE_INFINITY)).toThrow(TypeError)
    expect(() => parseDuration('15' as any)).toThrow(TypeError)
    expect(() => parseDuration('15 m' as any)).toThrow(TypeError)
    expect(() => parseDuration('1w' as any)).toThrow(TypeError)
    expect(() => parseDuration('-1s' as any)).toThrow(TypeError)
    expect(() => parseDuration(undefined as any)).toThrow(TypeError)
  })
})

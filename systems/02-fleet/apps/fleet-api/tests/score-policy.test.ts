import { describe, expect, it } from 'vitest'
import { priorityBand, scoreAnomaly } from '../src/score-policy'

const cases = [
  {
    severity: 'low',
    points: 1,
    expected: [
      { score: 1, band: 'P3', actions: ['reroute'], allowedActions: ['reroute'] },
      { score: 2, band: 'P3', actions: ['reroute'], allowedActions: ['reroute'] },
      { score: 3, band: 'P2', actions: ['queue'], allowedActions: ['contact_driver', 'hold'] },
      { score: 4, band: 'P2', actions: ['queue'], allowedActions: ['contact_driver', 'hold'] },
    ],
  },
  {
    severity: 'medium',
    points: 3,
    expected: [
      { score: 3, band: 'P2', actions: ['queue'], allowedActions: ['contact_driver', 'hold'] },
      { score: 4, band: 'P2', actions: ['queue'], allowedActions: ['contact_driver', 'hold'] },
      { score: 5, band: 'P2', actions: ['queue'], allowedActions: ['contact_driver', 'hold'] },
      {
        score: 6,
        band: 'P1',
        actions: ['stop_assignments', 'page_dispatcher'],
        allowedActions: ['contact_driver', 'hold', 'reroute'],
      },
    ],
  },
  {
    severity: 'high',
    points: 5,
    expected: [
      { score: 5, band: 'P2', actions: ['queue'], allowedActions: ['contact_driver', 'hold'] },
      {
        score: 6,
        band: 'P1',
        actions: ['stop_assignments', 'page_dispatcher'],
        allowedActions: ['contact_driver', 'hold', 'reroute'],
      },
      {
        score: 7,
        band: 'P1',
        actions: ['stop_assignments', 'page_dispatcher'],
        allowedActions: ['contact_driver', 'hold', 'reroute'],
      },
      {
        score: 8,
        band: 'P0',
        actions: ['emergency_stop', 'page_dispatcher', 'page_manager'],
        allowedActions: ['contact_driver', 'hold', 'cancel'],
      },
    ],
  },
  {
    severity: 'critical',
    points: 7,
    expected: [
      {
        score: 7,
        band: 'P1',
        actions: ['stop_assignments', 'page_dispatcher'],
        allowedActions: ['contact_driver', 'hold', 'reroute'],
      },
      {
        score: 8,
        band: 'P0',
        actions: ['emergency_stop', 'page_dispatcher', 'page_manager'],
        allowedActions: ['contact_driver', 'hold', 'cancel'],
      },
      {
        score: 9,
        band: 'P0',
        actions: ['emergency_stop', 'page_dispatcher', 'page_manager'],
        allowedActions: ['contact_driver', 'hold', 'cancel'],
      },
      {
        score: 10,
        band: 'P0',
        actions: ['emergency_stop', 'page_dispatcher', 'page_manager'],
        allowedActions: ['contact_driver', 'hold', 'cancel'],
      },
    ],
  },
] as const

describe('fleet escalation score policy', () => {
  it.each([
    [0, 'P3'],
    [3, 'P2'],
    [6, 'P1'],
    [8, 'P0'],
  ] as const)('maps score %d to priority band %s', (score, band) => {
    expect(priorityBand(score)).toBe(band)
  })

  for (const testCase of cases) {
    const timings = testCase.expected.map((expected, index) => [index * 5, expected] as const)
    it.each(timings)(
      `${testCase.severity} at %d seconds has exact score and actions`,
      (seconds, expected) => {
        const score = scoreAnomaly(testCase.severity, 1_000, 1_000 + seconds * 1_000)
        expect(score).toMatchObject({
          severity: testCase.severity,
          unresolvedSeconds: seconds,
          timerPoints: seconds / 5,
          score: expected.score,
          band: expected.band,
          actions: expected.actions,
          allowedActions: expected.allowedActions,
        })
      },
    )
  }

  it('changes timer points only at inclusive five-second boundaries', () => {
    expect(scoreAnomaly('low', 0, 4_999).timerPoints).toBe(0)
    expect(scoreAnomaly('low', 0, 5_000).timerPoints).toBe(1)
    expect(scoreAnomaly('low', 0, 9_999).timerPoints).toBe(1)
    expect(scoreAnomaly('low', 0, 10_000).timerPoints).toBe(2)
    expect(scoreAnomaly('low', 0, 14_999).timerPoints).toBe(2)
    expect(scoreAnomaly('low', 0, 15_000).timerPoints).toBe(3)
    expect(scoreAnomaly('low', 0, 60_000).timerPoints).toBe(3)
  })
})

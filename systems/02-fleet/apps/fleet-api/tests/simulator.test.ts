import { describe, expect, it } from 'vitest'
import { demoVehicleSimulations, telemetryForTick } from '../src/simulator'

describe('fleet telemetry simulator identity', () => {
  it('keeps retries stable while separating the same tick across restarts', () => {
    const simulation = demoVehicleSimulations[0]
    if (simulation === undefined) throw new Error('The demo simulation is required')

    const original = telemetryForTick(simulation, 0, 1_000)
    const retry = telemetryForTick(simulation, 0, 1_000)
    const restarted = telemetryForTick(simulation, 0, 2_000)

    expect(retry.commandId).toBe(original.commandId)
    expect(restarted.commandId).not.toBe(original.commandId)
    expect(original.commandId).toContain(':telemetry:1000:0')
  })
})

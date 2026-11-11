import { describe, expect, it } from 'vitest'
import { composeRestartArgs } from '../helpers/integration.js'

describe('integration Compose restart argv', () => {
  it('scopes a restart to the integration project', () => {
    expect(
      composeRestartArgs({
        DUNGEON_INTEGRATION_PROJECT: 'openwizard-dungeon-integration-test-123',
      }),
    ).toEqual([
      'compose',
      '-p',
      'openwizard-dungeon-integration-test-123',
      '-f',
      'compose.yaml',
      'restart',
      'dungeon-api',
    ])
  })

  it('keeps the main-stack argv unchanged when no integration project is set', () => {
    expect(composeRestartArgs({})).toEqual([
      'compose',
      '-f',
      'compose.yaml',
      'restart',
      'dungeon-api',
    ])
  })
})

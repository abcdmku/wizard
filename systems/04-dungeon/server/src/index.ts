import { createMemoryDurableStore } from '@openwizard/durable'
import { createMemoryPartyDirectory } from './directory.js'

export * from './auth.js'
export * from './directory.js'
export * from './domain.js'
export * from './engine.js'
export * from './frame-encoding.js'
export * from './generate.js'
export * from './player-source.js'
export * from './postgres.js'
export * from './projection.js'
export * from './registry.js'
export * from './runtime.js'
export * from './server.js'
export { MAX_CLIENT_MESSAGE_BYTES, RUNTIME_UNAVAILABLE_CLOSE_CODE } from './socket-session.js'
export * from './transport.js'
export * from './wizard.js'

export const createMemoryPartyRepository = () => ({
  store: createMemoryDurableStore(),
  directory: createMemoryPartyDirectory(),
})

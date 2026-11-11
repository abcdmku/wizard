import { NodeRuntime } from '@effect/platform-node'
import { Layer } from 'effect'
import { FleetApplicationLive } from './application'
import { FleetInfrastructureLive } from './infrastructure'
import { makeFleetServer } from './server'

const parsedPort = Number(process.env.PORT ?? '8787')
if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535')
}

const MainLive = makeFleetServer({
  host: process.env.HOST?.trim() || '0.0.0.0',
  port: parsedPort,
}).pipe(Layer.provide(FleetApplicationLive), Layer.provide(FleetInfrastructureLive))

Layer.launch(MainLive).pipe(NodeRuntime.runMain)

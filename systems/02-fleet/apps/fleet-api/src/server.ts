import { createServer } from 'node:http'
import { NodeHttpServer } from '@effect/platform-node'
import { Layer } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { FleetHttpApiLive } from './http-api'

export interface FleetServerOptions {
  readonly host: string
  readonly port: number
}

export function makeFleetServer(options: FleetServerOptions) {
  const routes = Layer.merge(FleetHttpApiLive, HttpRouter.cors())
  return HttpRouter.serve(routes).pipe(Layer.provide(NodeHttpServer.layer(createServer, options)))
}

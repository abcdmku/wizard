import { createMirrorSource, parseFrame, parseWireCommand } from '@openwizard/core/mirror'
import { orderStatus } from './projection'
import { openOrder } from './run'
import { order } from './wizard'

/** A command decoded from a request body. */
export function decodeCommand(body: unknown) {
  return parseWireCommand(order, body)
}

/** A frame decoded by a relay. */
export function decodeFrame(message: unknown) {
  return parseFrame(message)
}

/** The server half of a mirror. */
export function orderSource(orderId: string) {
  return createMirrorSource(openOrder(orderId), orderStatus)
}

/** Typed browser replicas, server frame sources and the wire protocol. */

export type {
  MirrorChild,
  MirrorCommands,
  MirrorResult,
  TransportFailure,
} from './commands'
export { createMirror, type Mirror, type MirrorOptions } from './create-mirror'
export {
  createMirrorSource,
  type MirrorAuthorizationInput,
  type MirrorSource,
  type MirrorSourceOptions,
} from './source'
export type { Transport } from './transport'
export {
  type Frame,
  type ProgressFrame,
  parseFrame,
  parseWireCommand,
  type SnapshotFrame,
  type StepProgressEvent,
  type WireAck,
  type WireCommand,
} from './wire'

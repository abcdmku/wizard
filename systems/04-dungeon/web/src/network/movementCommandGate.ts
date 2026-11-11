import type {
  AckFrame,
  ClientCommand,
  ClientCommandMessage,
  ErrorFrame,
} from '@wizard/dungeon-shared'

type CommandId = ClientCommandMessage['commandId']

export class MovementCommandGate {
  #inFlight: CommandId | null = null

  start(commandId: CommandId, command: ClientCommand): boolean {
    if (command.type !== 'move') return true
    if (this.#inFlight !== null) return false
    this.#inFlight = commandId
    return true
  }

  settle(commandId: CommandId): boolean {
    if (this.#inFlight !== commandId) return false
    this.#inFlight = null
    return true
  }

  settleFrame(frame: AckFrame | ErrorFrame): boolean {
    if (frame.commandId !== null) return this.settle(frame.commandId)
    if (frame.type !== 'error' || frame.error.code !== 'server-error') return false
    const released = this.#inFlight !== null
    this.clear()
    return released
  }

  clear(): void {
    this.#inFlight = null
  }

  get inFlight(): CommandId | null {
    return this.#inFlight
  }
}

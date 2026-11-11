/** Correlate a host's exact command object and its result with the batch that commits it. */
import type { Command, Message } from '../../machine/commands'
import type { DomainEvent } from '../../machine/events'
import type { CommandResult } from '../results'
import {
  commandResult,
  findRejected,
  navToCommandResult,
  ownTxId,
  sendResult,
  sendToCommandResult,
  toNavResult,
} from './results'
import { terminalIn, toOutcome } from './transactions'

export interface CommandCommit {
  readonly command: Command
  /** Absent only while a navigation transaction is still pending. */
  readonly result?: CommandResult
}

export function createCommandCommits() {
  const messages = new Map<Message, CommandCommit>()
  const transactions = new Map<string, Command>()
  return {
    register(message: Message, command: Command, result?: CommandResult) {
      messages.set(message, { command, ...(result === undefined ? {} : { result }) })
    },
    forBatch(
      message: Message,
      batch: readonly DomainEvent[],
      seq: number,
    ): readonly CommandCommit[] {
      const out: CommandCommit[] = []
      const own = messages.get(message)
      messages.delete(message)
      if (own !== undefined) {
        const { command } = own
        const processed = { batch, seq, disposed: false }
        const rejected = findRejected(batch)
        if (rejected !== undefined && (own.result === undefined || rejected.code === 'STALE'))
          out.push({ command, result: commandResult(processed) })
        else if (own.result !== undefined) out.push(own)
        else if (command.type === 'next' || command.type === 'back' || command.type === 'go') {
          const txId = ownTxId(batch)
          const terminal =
            txId === undefined
              ? batch.find((event) => event.type === 'transition.rejected')
              : terminalIn(batch, txId)
          if (terminal !== undefined) {
            out.push({ command, result: navToCommandResult(toNavResult(toOutcome(terminal))) })
          } else if (txId !== undefined) {
            transactions.set(txId, command)
            out.push({ command })
          } else out.push({ command, result: commandResult(processed) })
        } else {
          const result =
            command.type === 'send'
              ? sendToCommandResult(sendResult(command.event, processed, command.eventId))
              : commandResult(processed)
          out.push({ command, result })
        }
      }
      for (const event of batch) {
        if (
          event.type !== 'transition.committed' &&
          event.type !== 'transition.rejected' &&
          event.type !== 'transition.failed'
        )
          continue
        const command = transactions.get(event.txId)
        if (command === undefined) continue
        transactions.delete(event.txId)
        out.push({ command, result: navToCommandResult(toNavResult(toOutcome(event))) })
      }
      return out
    },
    clear() {
      messages.clear()
      transactions.clear()
    },
  }
}

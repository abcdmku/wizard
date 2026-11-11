import type { ApplicationCommand } from '../../shared/index.js'

/** Remove REST-only durability metadata before the core parses the command. */
export function coreCommandInput(command: ApplicationCommand): unknown {
  switch (command.type) {
    case 'start':
    case 'next':
    case 'back':
      return { type: command.type }
    case 'go':
      return { type: command.type, step: command.step }
    case 'setInput':
      return { type: command.type, step: command.step, patch: command.patch }
    case 'resetInput':
      return { type: command.type, step: command.step }
    case 'cancel':
      return command.reason === undefined
        ? { type: command.type }
        : { type: command.type, reason: command.reason }
  }
}

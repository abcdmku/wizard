import { Schema } from 'effect'

export class FleetDatabaseError extends Schema.TaggedError<FleetDatabaseError>()(
  'FleetDatabaseError',
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Fleet database operation failed: ${this.operation}`
  }
}

export const databaseError =
  (operation: string) =>
  (cause: unknown): FleetDatabaseError =>
    new FleetDatabaseError({ operation, cause })

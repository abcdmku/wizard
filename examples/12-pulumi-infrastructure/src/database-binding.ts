import * as pulumi from '@pulumi/pulumi'

export type DurableDatabaseDialect = 'postgresql' | 'sqlite'

export interface DurableDatabaseBindingArgs {
  readonly dialect: pulumi.Input<DurableDatabaseDialect>
  readonly connectionUrl: pulumi.Input<string>
}

export interface DurableDatabaseBinding {
  readonly dialect: pulumi.Output<DurableDatabaseDialect>
  readonly connectionUrl: pulumi.Output<string>
}

/** Validate database config and preserve the connection URL as a Pulumi secret. */
export function bindDurableDatabase(args: DurableDatabaseBindingArgs): DurableDatabaseBinding {
  const dialect = pulumi.output(args.dialect).apply(assertDialect)
  return {
    dialect,
    connectionUrl: pulumi.secret(args.connectionUrl),
  }
}

export function parseDurableDatabaseDialect(value: string): DurableDatabaseDialect {
  return assertDialect(value)
}

function assertDialect(value: string): DurableDatabaseDialect {
  if (value !== 'postgresql' && value !== 'sqlite') {
    throw new Error(`Unsupported durable database dialect: ${String(value)}`)
  }
  return value
}

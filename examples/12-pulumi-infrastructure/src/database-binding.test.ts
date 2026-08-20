import * as pulumi from '@pulumi/pulumi'
import { describe, expect, it } from 'vitest'
import { bindDurableDatabase, parseDurableDatabaseDialect } from './database-binding'

describe('database infrastructure binding', () => {
  it('accepts only adapter dialects', () => {
    expect(parseDurableDatabaseDialect('postgresql')).toBe('postgresql')
    expect(parseDurableDatabaseDialect('sqlite')).toBe('sqlite')
    expect(() => parseDurableDatabaseDialect('mysql')).toThrow(
      'Unsupported durable database dialect: mysql',
    )
  })

  it('wraps configuration values in Pulumi outputs', () => {
    const binding = bindDurableDatabase({
      dialect: 'postgresql',
      connectionUrl: 'postgresql://example.invalid/openwizard',
    })

    expect(pulumi.Output.isInstance(binding.dialect)).toBe(true)
    expect(pulumi.Output.isInstance(binding.connectionUrl)).toBe(true)
  })
})

import { type Command, defineFlow, defineProjection, type FlowRun } from '@openwizard/core'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import {
  type AnyHTTPResource,
  createBearerScopeProvider,
  defineRunAPI,
  type RunAPICommandContext,
} from '../src'

const builder = defineFlow({
  name: 'typed-api',
  context: z.object({ accountId: z.string() }),
})
const flow = builder.steps({
  load: builder.task(() => 1),
  done: builder.final(),
})
const projection = defineProjection(flow, { expose: { steps: { load: { output: true } } } })
type Principal = { readonly subject: string }
const scopes = createBearerScopeProvider<Principal>({
  verify: () => ({
    tenantId: 'tenant-1',
    principal: { subject: 'user-1' },
    scopes: ['typed-api:read'],
  }),
})
declare const run: FlowRun<typeof flow>

const api = defineRunAPI({
  flow,
  projection,
  scopeProvider: scopes,
  resolveRun: (context) => {
    expectTypeOf(context.principal).toEqualTypeOf<Principal>()
    expectTypeOf(context.runId).toEqualTypeOf<string>()
    expectTypeOf(context.tenantId).toEqualTypeOf<string>()
    return run
  },
  readSteps: ['load'],
  commands: {
    allow: (context) => {
      expectTypeOf(context).toMatchTypeOf<RunAPICommandContext<typeof flow, Principal>>()
      expectTypeOf(context.command).toEqualTypeOf<Command<typeof flow>>()
      expectTypeOf(context.run).toEqualTypeOf<FlowRun<typeof flow>>()
      return context.command.type === 'run' && context.command.step === 'load'
    },
  },
})

expectTypeOf(api.resources[0]).toMatchTypeOf<AnyHTTPResource | undefined>()

defineRunAPI({
  flow,
  projection,
  scopeProvider: scopes,
  resolveRun: () => run,
  // @ts-expect-error readSteps only accepts declared step ids
  readSteps: ['missing'],
})

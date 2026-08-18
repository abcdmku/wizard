/**
 * `mirror.child(step)` (v0.2, plan §9.9): a scoped sender whose sugar wraps every command as
 * `{ type: 'child', path, command }` — end to end over the loopback with a nested flow, nested
 * `.child().child()`, and the wire shape of the v0.2 sugar (`skip` / `invalidate`).
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineFlow } from '../../src/authoring/define-flow'
import { createSequentialIds } from '../../src/interpreter/env'
import { createMirror } from '../../src/mirror/create-mirror'
import { createLocalTransport } from '../../src/mirror/local-transport'
import { createMirrorSource } from '../../src/mirror/source'
import type { Transport } from '../../src/mirror/transport'
import type { Frame, WireAck, WireCommand } from '../../src/mirror/wire'
import { defineProjection } from '../../src/projection/define-projection'
import { createWizard } from '../../src/wizard/create-wizard'

const g = defineFlow({ name: 'grandchild', context: z.object({ sku: z.string() }) })
const grandchild = g.steps({
  pick: g.view({ input: z.object({ bin: z.string() }), next: 'done' }),
  done: g.final({ output: ({ context }) => ({ sku: context.sku }) }),
})
const f = defineFlow({
  name: 'fulfilment',
  context: z.object({ orderId: z.string(), warehouse: z.string().optional() }),
})
const fulfilment = f.steps({
  confirm: f.view({
    input: z.object({ warehouse: z.string() }),
    exit: ({ output, update }) => update({ warehouse: output.warehouse }),
    next: 'pack',
  }),
  pack: f.flow(grandchild, { context: () => ({ sku: 'sku-1' }), next: 'done' }),
  done: f.final({ output: ({ context }) => ({ warehouse: context.warehouse }) }),
})
const o = defineFlow({ name: 'order', context: z.object({ cartId: z.string() }) })
const order = o.steps({
  fulfil: o.flow(fulfilment, {
    context: ({ context }) => ({ orderId: context.cartId }),
    next: 'end',
  }),
  end: o.final({ output: () => 'shipped' }),
})
const orderClient = defineProjection(order, {
  expose: {
    steps: {
      fulfil: {
        output: true,
        child: {
          steps: {
            confirm: { input: true },
            pack: { child: { steps: { pick: { input: true } } } },
          },
          context: ['orderId'],
        },
      },
    },
    output: true,
  },
})

async function loop() {
  const wizard = createWizard(order, {
    context: { cartId: 'c-1' },
    ids: createSequentialIds(),
    instanceId: 'wiz-1',
  })
  await wizard.start()
  const source = createMirrorSource(wizard, orderClient)
  const mirror = createMirror<typeof orderClient>({ transport: createLocalTransport(source) })
  return { wizard, mirror, source }
}

describe('mirror.child(step)', () => {
  it('drives a nested flow through child commands; the projected child slice follows', async () => {
    const { wizard, mirror } = await loop()
    const child = mirror.child('fulfil')
    expect(child.path).toEqual(['fulfil'])
    // The child slice is in the frame (exposed with a nested spec).
    expect(mirror.getSnapshot()?.steps.fulfil.child).toMatchObject({
      current: 'confirm',
      context: { orderId: 'c-1' },
      steps: { confirm: { status: 'active' } },
    })
    expect(await child.setInput('confirm', { warehouse: 'east' })).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.fulfil.child?.steps.confirm.input).toEqual({
      warehouse: 'east',
    })
    expect(await child.next()).toMatchObject({ ok: true })
    // confirm → pack: the grandchild is created and its view is current.
    expect(wizard.child('fulfil').getState().current).toBeNull()
    expect(wizard.child('fulfil').child('pack').getState().current).toBe('pick')
    const grand = child.child('pack')
    expect(grand.path).toEqual(['fulfil', 'pack'])
    expect(mirror.getSnapshot()?.steps.fulfil.child?.steps.pack.child).toMatchObject({
      current: 'pick',
      steps: { pick: { status: 'active' } },
    })
    expect(await grand.setInput('pick', { bin: 'B-7' })).toMatchObject({ ok: true })
    expect(mirror.getSnapshot()?.steps.fulfil.child?.steps.pack.child?.steps.pick.input).toEqual({
      bin: 'B-7',
    })
    expect(await grand.next()).toMatchObject({ ok: true })
    // The whole tree completes: grandchild → child → root.
    expect(wizard.getState().status).toBe('done')
    expect(mirror.getSnapshot()).toMatchObject({
      status: 'done',
      output: 'shipped',
      steps: { fulfil: { status: 'done', output: { warehouse: 'east' } } },
    })
    // A wrong id inside the child is decoded against the CHILD flow by the server.
    expect(await child.dispatch({ type: 'go', step: 'nope' } as never)).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
    })
    // A child command to a non-flow step is rejected by the decoder too.
    expect(await mirror.child('end' as never).next()).toMatchObject({
      ok: false,
      code: 'INVALID_COMMAND',
    })
    wizard.dispose()
    mirror.dispose()
  })

  it('wraps every command as { type: child, path, command } — flattened for nested senders; skip / invalidate too', async () => {
    const sent: WireCommand[] = []
    let onFrame: ((frame: Frame<unknown>) => void) | undefined
    const transport: Transport<unknown> = {
      subscribe(cb) {
        onFrame = cb
        return () => {}
      },
      async send(command) {
        sent.push(command)
        const ack: WireAck = { commandId: command.commandId, result: { ok: true, seq: 1 }, seq: 1 }
        return ack
      },
    }
    const mirror = createMirror<typeof orderClient>({ transport: transport as never })
    onFrame?.({ kind: 'snapshot', instanceId: 'i', epoch: 0, seq: 0, state: {} })
    const child = mirror.child('fulfil')
    const grand = child.child('pack')
    await child.go('confirm')
    await child.setInput('confirm', { warehouse: 'w' })
    await child.skip('confirm', 'not needed')
    await child.invalidate('confirm', { cascade: false })
    await grand.next()
    await grand.send('typo' as never, { a: 1 }, { correlationId: 'c' })
    await mirror.skip('fulfil')
    await mirror.invalidate('fulfil')
    expect(sent.map((w) => w.command)).toEqual([
      { type: 'child', path: ['fulfil'], command: { type: 'go', step: 'confirm' } },
      {
        type: 'child',
        path: ['fulfil'],
        command: { type: 'setInput', step: 'confirm', patch: { warehouse: 'w' } },
      },
      {
        type: 'child',
        path: ['fulfil'],
        command: { type: 'skip', step: 'confirm', reason: 'not needed' },
      },
      {
        type: 'child',
        path: ['fulfil'],
        command: { type: 'invalidate', step: 'confirm', cascade: false },
      },
      { type: 'child', path: ['fulfil', 'pack'], command: { type: 'next' } },
      {
        type: 'child',
        path: ['fulfil', 'pack'],
        command: { type: 'send', event: 'typo', payload: { a: 1 }, correlationId: 'c' },
      },
      { type: 'skip', step: 'fulfil' },
      { type: 'invalidate', step: 'fulfil' },
    ])
    // Every wire command is addressed to the mirrored instance.
    expect(new Set(sent.map((w) => w.instanceId))).toEqual(new Set(['i']))
    mirror.dispose()
  })
})

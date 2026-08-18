/**
 * The UI. Every component reads and writes ONLY through the hooks of `ow` (a Mirror behind a
 * Provider). Nothing here imports the wizard, the flow module or the server.
 */
import type { Issue, Mirror } from '@openwizard/core'
import { type ReactNode, useId, useState } from 'react'
import { ow } from './client'
import type { checkoutClient } from './flow'
import { tokenizeCard } from './payments'

export function App({ mirror }: { mirror: Mirror<typeof checkoutClient> }) {
  return (
    <main className="page">
      <header className="masthead">
        <p className="eyebrow">OpenWizard · example 08</p>
        <h1>Checkout, mirrored</h1>
        <p className="lede">
          The wizard runs in an in-page “server”. This UI only sees a <code>Mirror</code> over a
          deny-by-default projection and sends commands over a loopback transport (with latency).
        </p>
      </header>
      <ow.Provider source={mirror} fallback={<Connecting />}>
        <Checkout />
      </ow.Provider>
    </main>
  )
}

function Connecting() {
  return (
    <section className="card">
      <p className="muted">Waiting for the first frame…</p>
    </section>
  )
}

function Checkout() {
  const status = ow.useSelector((s) => s.status)
  const current = ow.useCurrent()
  let body: ReactNode
  if (current?.id === 'shipping') body = <ShippingForm />
  else if (current?.id === 'payment') body = <PaymentForm />
  else if (status === 'done') body = <Receipt />
  else body = <TaskPanel />
  return (
    <section className="card">
      <Progress />
      {body}
      <WireStatus />
    </section>
  )
}

/** Step rail. `useSnapshot()` re-renders on every frame — fine for a summary of everything. */
function Progress() {
  const state = ow.useSnapshot()
  const order = ['shipping', 'payment', 'reserve', 'charge', 'receipt'] as const
  return (
    <ol className="rail">
      {order.map((id) => {
        const step = state.steps[id]
        return (
          <li key={id} className={`rail-item is-${step.status}`}>
            <span className="rail-dot" aria-hidden="true" />
            <span className="rail-label">{id}</span>
            <span className="rail-status">{step.phase ?? step.status}</span>
          </li>
        )
      })}
    </ol>
  )
}

function ShippingForm() {
  // Typed from the projection: `input` is the draft, `setInput` accepts a partial of it.
  const { input, issues, status, setInput, next } = ow.useStep('shipping')
  const busy = status !== 'active'
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void next()
      }}
    >
      <h2>Shipping</h2>
      <Field label="Full name" issues={issuesFor(issues, 'name')}>
        {(id) => (
          <input
            id={id}
            value={input?.name ?? ''}
            onChange={(e) => void setInput({ name: e.target.value })}
            autoComplete="name"
          />
        )}
      </Field>
      <Field label="Address" issues={issuesFor(issues, 'address')}>
        {(id) => (
          <input
            id={id}
            value={input?.address ?? ''}
            onChange={(e) => void setInput({ address: e.target.value })}
            autoComplete="street-address"
          />
        )}
      </Field>
      <label className="check">
        <input
          type="checkbox"
          checked={input?.express ?? false}
          onChange={(e) => void setInput({ express: e.target.checked })}
        />
        Express delivery
      </label>
      <RootIssues issues={issues} fields={['name', 'address', 'express']} />
      <div className="actions">
        <button type="submit" disabled={busy}>
          Continue to payment
        </button>
      </div>
    </form>
  )
}

/**
 * The card number lives in LOCAL component state only. On submit it goes to the payment
 * provider (`tokenizeCard`, the browser SDK stand-in) and only the returned token reaches the
 * wizard through `setInput` — so no PAN in any draft, snapshot, projection or frame.
 */
function PaymentForm() {
  const { input, issues, status, setInput, next, back } = ow.useStep('payment')
  const total = ow.useSelector((s) => s.context.total)
  const express = ow.useSelector((s) => s.context.express)
  const [card, setCard] = useState('')
  const [tokenizing, setTokenizing] = useState(false)
  const [cardError, setCardError] = useState<string | null>(null)
  const busy = status !== 'active' || tokenizing
  const pay = async () => {
    setTokenizing(true)
    setCardError(null)
    try {
      const { token, last4 } = await tokenizeCard(card) // PAN → provider, token ← provider
      await setInput({ paymentToken: token, last4 }) // the wizard only ever sees the token
      await next()
    } catch (error) {
      setCardError(error instanceof Error ? error.message : String(error))
    } finally {
      setTokenizing(false)
    }
  }
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault()
        void pay()
      }}
    >
      <h2>Payment</h2>
      <p className="muted">
        Total {money(total)}
        {express ? ' · express' : ''}
        {input?.last4 ? ` · card ending ${input.last4} tokenised` : ''}
      </p>
      <Field label="Card number" issues={cardError === null ? [] : [{ message: cardError }]}>
        {(id) => (
          <input
            id={id}
            inputMode="numeric"
            autoComplete="cc-number"
            value={card}
            onChange={(e) => setCard(e.target.value.replace(/\D/g, ''))}
            placeholder="16 digits"
          />
        )}
      </Field>
      <button type="button" className="link" onClick={() => setCard('4242424242424242')}>
        Use a test card
      </button>
      <RootIssues issues={issues} fields={[]} />
      <div className="actions">
        <button type="button" className="secondary" onClick={() => void back()} disabled={busy}>
          Back
        </button>
        <button type="submit" disabled={busy}>
          {tokenizing ? 'Tokenising…' : `Pay ${money(total)}`}
        </button>
      </div>
    </form>
  )
}

/** Running tasks: status, live phase and attempt are base facts of the projection; `error` is exposed for these two steps. */
function TaskPanel() {
  const reserve = ow.useStep('reserve')
  const charge = ow.useStep('charge')
  const status = ow.useSelector((s) => s.status)
  const { cancel } = ow.useActions()
  return (
    <div className="form">
      <h2>{status === 'running' ? 'Processing your order…' : `Order ${status}`}</h2>
      <TaskRow label="Reserve stock" step={reserve} />
      <TaskRow label="Charge card" step={charge} />
      {status === 'running' && (
        <div className="actions">
          <button type="button" className="secondary" onClick={() => void cancel('customer')}>
            Cancel order
          </button>
        </div>
      )}
    </div>
  )
}

function TaskRow({
  label,
  step,
}: {
  label: string
  step: { status: string; phase?: string; attempt: number; error?: { message: string } }
}) {
  const live = step.status === 'active'
  return (
    <div className={`task is-${step.status}`}>
      <span className={`spinner${live ? ' on' : ''}`} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <div className="muted">
          {step.phase ?? step.status}
          {step.attempt > 0 ? ` · attempt ${step.attempt}` : ''}
        </div>
        {step.error && <div className="issue">{step.error.message}</div>}
      </div>
    </div>
  )
}

function Receipt() {
  const output = ow.useSelector((s) => s.output)
  return (
    <div className="form">
      <h2>Thank you{output?.customer ? `, ${output.customer}` : ''}!</h2>
      <dl className="receipt">
        <dt>Total</dt>
        <dd>{money(output?.total ?? 0)}</dd>
        <dt>Delivery</dt>
        <dd>{output?.express ? 'Express' : 'Standard'}</dd>
        <dt>Reservation</dt>
        <dd>{output?.reservationId}</dd>
        <dt>Charge</dt>
        <dd>{output?.chargeId}</dd>
      </dl>
    </div>
  )
}

/** Frame counter: proves the UI is fed by frames (`seq`) of one instance/epoch. */
function WireStatus() {
  const wire = ow.useSelector(
    (s) => ({ instanceId: s.instanceId, epoch: s.epoch, seq: s.seq }),
    (a, b) => a.instanceId === b.instanceId && a.epoch === b.epoch && a.seq === b.seq,
  )
  return (
    <footer className="wire">
      frame · instance <code>{wire.instanceId}</code> · epoch {wire.epoch} · seq {wire.seq}
    </footer>
  )
}

function Field({
  label,
  issues,
  children,
}: {
  label: string
  issues: readonly Issue[]
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {issues.map((i) => (
        <span key={i.message} className="issue">
          {i.message}
        </span>
      ))}
    </div>
  )
}

/** Issues not attached to a known field (e.g. a whole-object failure). */
function RootIssues({
  issues,
  fields,
}: {
  issues: readonly Issue[] | undefined
  fields: readonly string[]
}) {
  const rest = (issues ?? []).filter((i) => !fields.includes(String(fieldOf(i))))
  if (rest.length === 0) return null
  return (
    <div>
      {rest.map((i) => (
        <span key={i.message} className="issue">
          {i.message}
        </span>
      ))}
    </div>
  )
}

function issuesFor(issues: readonly Issue[] | undefined, field: string): readonly Issue[] {
  return (issues ?? []).filter((i) => fieldOf(i) === field)
}

/** First path segment of a Standard-Schema issue (`['name']` or `[{ key: 'name' }]`). */
function fieldOf(issue: Issue): PropertyKey | undefined {
  const head = issue.path?.[0]
  return typeof head === 'object' && head !== null ? head.key : head
}

const money = (n: number) => `€${n.toFixed(2)}`

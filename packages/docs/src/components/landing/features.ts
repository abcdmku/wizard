/** One line of generated output shown on the home page. */
export interface OutputLine {
  readonly text: string
  readonly tone?: 'good' | 'bad' | 'dim'
}

/** Something the refund wizard produces, shown as the output itself. */
export interface Output {
  readonly title: string
  readonly body: string
  readonly lines: readonly OutputLine[]
  readonly link: string
  readonly to: string
}

/** The routes `createHTTP(refund, ...)` serves. A test compares them with its OpenAPI document. */
export const refundRoutes = [
  'POST /api/refund',
  'GET /api/refund/{runId}',
  'GET /api/refund/{runId}/stream',
  'POST /api/refund/{runId}/events/refund.approved',
] as const

/** The signed route for the event. The same test checks it. */
export const refundWebhook = 'POST /webhooks/refund/refund.approved'

/** Rows of the page `toMarkdown(inspect(refund))` prints. The same test checks them. */
export const refundDocRows = [
  '| `order` | step | its wizard starts | Runs work | feeds `pay` |',
  '| `managerApproval` | step | `route` routes here | Waits for `refund.approved` | feeds `pay` |',
] as const

export const outputs: readonly Output[] = [
  {
    title: 'Type errors, not incidents',
    body: 'Every step gets the outputs it needs, typed. Break a hand-off and the build stops.',
    lines: [
      { text: 'needs.order.totl' },
      { text: "Property 'totl' does not exist.", tone: 'bad' },
      { text: "Did you mean 'total'?", tone: 'bad' },
    ],
    link: 'Pass data between steps',
    to: 'guide/needs',
  },
  {
    title: 'An HTTP API',
    body: 'Routes, scopes and an OpenAPI 3.1 document. You write none of them.',
    lines: refundRoutes.map((text) => ({ text })),
    link: 'HTTP API',
    to: 'production/http',
  },
  {
    title: 'Signed webhooks',
    body: 'Other systems post events straight into a waiting run.',
    lines: [
      { text: refundWebhook },
      { text: '✓ signature verified', tone: 'good' },
      { text: '✓ payload parsed by the event schema', tone: 'good' },
      { text: '✓ repeated delivery dropped', tone: 'good' },
    ],
    link: 'Receive a webhook',
    to: 'production/http',
  },
  {
    title: 'Docs that cannot go stale',
    body: 'One call prints the diagram, every step and every schema. It reads the code, so it matches the code.',
    lines: [
      { text: 'order: starts with the wizard', tone: 'dim' },
      { text: 'managerApproval: waits for refund.approved', tone: 'dim' },
      { text: 'pay: 2 retries, feeds the result', tone: 'dim' },
    ],
    link: 'Inspect and debug',
    to: 'guide/inspect',
  },
  {
    title: 'Runs that outlive the process',
    body: 'A run is JSON in your PostgreSQL or SQLite. Kill the server and nothing is lost.',
    lines: [
      { text: 'server A dies in the middle of pay', tone: 'bad' },
      { text: 'its lease expires after 30 s', tone: 'dim' },
      { text: 'server B resumes the run', tone: 'good' },
      { text: 'the key stops a second charge', tone: 'good' },
    ],
    link: 'Run on a server',
    to: 'production/server',
  },
  {
    title: 'Failure handling in two lines',
    body: 'Retries, timeouts, fallbacks and undo are options on the step.',
    lines: [
      { text: "retry: { retries: 2, backoff: 'exponential' }," },
      { text: 'idempotencyKey: ({ context }) =>' },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: this is source code shown as text
      { text: '  `refund:${context.orderId}`,' },
    ],
    link: 'Handle failures',
    to: 'guide/failures',
  },
]

/** A chore a workflow needs without an engine, and the line of a wizard that replaces it. */
export interface Replacement {
  readonly chore: string
  readonly code: string
}

export const replacements: readonly Replacement[] = [
  {
    chore: 'A status column and a cron job that polls it',
    code: "waitFor: { 'refund.approved': ... }",
  },
  {
    chore: 'A retry loop around every service call',
    code: "retry: { retries: 2, backoff: 'exponential' }",
  },
  { chore: 'An API route for every button', code: 'createHTTP(refund, { access })' },
  {
    chore: 'A webhook handler that checks signatures',
    code: "receive: { events: ['refund.approved'] }",
  },
  { chore: 'A wiki page that describes last quarter', code: 'toMarkdown(inspect(refund))' },
  { chore: 'A run that dies with the deploy', code: 'refund.resume(snapshot)' },
]

/** Why this matters when an agent does the work or writes it. */
export const agentPoints: readonly { readonly claim: string; readonly answer: string }[] = [
  {
    claim: 'Agents run for days.',
    answer:
      'A run waits on a tool, a person or a webhook without holding a process, then resumes on any server.',
  },
  {
    claim: 'Agents send bad input.',
    answer:
      'A schema parses every payload before your code sees it. The agent gets the issues back and tries again.',
  },
  {
    claim: 'Agents write the workflow.',
    answer:
      'A wrong hand-off is a compile error. The package ships its own guide for coding agents, and a stuck run says why.',
  },
]

/** Smaller parts of the project, each with its own page. */
export const extras: readonly { readonly label: string; readonly to: string }[] = [
  { label: 'Forms', to: 'guide/forms' },
  { label: 'React bindings', to: 'production/client' },
  { label: 'OpenTelemetry tracing', to: 'production/tracing' },
  { label: 'Fake time in tests', to: 'guide/test' },
  { label: 'Child wizards', to: 'guide/children' },
]

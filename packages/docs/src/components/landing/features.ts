/** One thing the home page claims: what it is, the fact behind it and, for a feature, the page that teaches it. */
export interface Feature {
  readonly title: string
  readonly body: string
  readonly link?: string
  readonly to?: string
}

/** What one wizard definition produces. */
export const features: readonly Feature[] = [
  {
    title: 'A type-safe async orchestrator',
    body: 'Steps start as soon as the steps they need finish, in parallel where they can. Each one receives those outputs typed. A wrong step id or a changed return type fails the build, and a broken definition lists every problem when the module loads.',
    link: 'Pass data between steps',
    to: 'guide/needs',
  },
  {
    title: 'A generated HTTP API',
    body: 'The HTTP package turns a wizard into routes that create a run, send it commands and events, and stream its state to a browser. It also returns the OpenAPI 3.1 document. A capability you do not grant gets no route.',
    link: 'HTTP API and webhooks',
    to: 'production/http',
  },
  {
    title: 'Signed webhook routes',
    body: 'Each event you choose to receive gets a route other systems can post to. The route verifies the Standard Webhooks signature, parses the payload with the event schema and drops a repeated delivery by its id.',
    link: 'Receive a webhook',
    to: 'production/http',
  },
  {
    title: 'Generated documentation',
    body: 'One call prints a wizard as a page: a diagram, a table of every step, the JSON Schema of each input and output, the events and the warnings. It reads the definition and never runs your code.',
    link: 'Inspect and debug',
    to: 'guide/inspect',
  },
  {
    title: 'Persistence and crash recovery',
    body: 'A run is JSON in your PostgreSQL or SQLite. Leases and fenced writes keep two servers off the same run. When a process dies, another takes the run after 30 seconds and resumes it. An event that arrives early waits in the run until a step asks for it.',
    link: 'Run on a server',
    to: 'production/server',
  },
  {
    title: 'Failure handling on the step',
    body: 'Retries with backoff, timeouts, a fallback step and an undo for work that already finished are options on a step. An idempotency key makes a charge that runs twice safe.',
    link: 'Handle failures',
    to: 'guide/failures',
  },
]

/** Why the same facts matter when an agent does the work or writes the workflow. */
export const agentPoints: readonly Feature[] = [
  {
    title: 'Agent work is long-running',
    body: 'A model call, three tool calls, a person who approves on Monday and a webhook an hour later are one run. It waits without holding a process and resumes on any server.',
  },
  {
    title: 'A model cannot send a bad payload',
    body: 'Every event and form has a schema. The run parses the payload before your code sees it and returns the issues as a value the agent can read and correct.',
  },
  {
    title: 'The compiler reviews generated code',
    body: 'When an agent writes or edits a wizard, a wrong hand-off between steps is a type error, not a failure in production. Definition errors arrive together, so one pass fixes them.',
  },
  {
    title: 'Agents can read a wizard and a stuck run',
    body: 'The package ships a guide for coding agents that matches the installed version. A wizard exports as JSON, and a run answers why a step has not started with a reason code.',
  },
]

/** Smaller parts of the project, each with its own page. */
export const extras: readonly { readonly label: string; readonly to: string }[] = [
  { label: 'Forms with validated drafts', to: 'guide/forms' },
  { label: 'React bindings and a client-safe view of a run', to: 'production/client' },
  { label: 'OpenTelemetry tracing', to: 'production/tracing' },
  { label: 'A scheduler that fakes time in tests', to: 'guide/test' },
  { label: 'Child wizards', to: 'guide/children' },
]

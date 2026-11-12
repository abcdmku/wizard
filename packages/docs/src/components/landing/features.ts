/** One core feature on the home page: what it is, the fact behind it and the page that teaches it. */
export interface Feature {
  readonly title: string
  readonly body: string
  readonly link: string
  readonly to: string
}

export const features: readonly Feature[] = [
  {
    title: 'One definition for the whole flow',
    body: 'A step runs work, shows a form, waits for an event or a deadline, picks a branch or runs another wizard. The form, the service call and the three-day wait live in one file.',
    link: 'How steps work',
    to: 'guide',
  },
  {
    title: 'The compiler checks every hand-off',
    body: 'A step lists the steps it needs and receives their outputs, typed. Rename a step or change what it returns, and every step that reads it fails the build.',
    link: 'Pass data between steps',
    to: 'guide/needs',
  },
  {
    title: 'A run is JSON',
    body: 'Save a run to any database after any command. Resume it after a deploy, a crash or a month of waiting, and it continues from the step it stopped on.',
    link: 'Save and resume',
    to: 'guide/save-resume',
  },
  {
    title: 'Failure handling sits on the step',
    body: 'Retries with backoff, timeouts, a fallback step and an undo for work that already finished are options, not code you write around the flow. An idempotency key makes a repeated charge safe.',
    link: 'Handle failures',
    to: 'guide/failures',
  },
  {
    title: 'Runs on the database you have',
    body: 'Runs live in your PostgreSQL or SQLite. Leases and fenced writes stop two servers from advancing the same run. You operate no workflow cluster and no queue.',
    link: 'Run on a server',
    to: 'production/server',
  },
  {
    title: 'Readable by people and coding agents',
    body: 'One call prints a wizard as a diagram and a table without running it. Another says why a step has not started. The package ships the same facts as a guide for coding agents.',
    link: 'Inspect and debug',
    to: 'guide/inspect',
  },
]

/** Smaller parts of the project, each with its own page. */
export const extras: readonly { readonly label: string; readonly to: string }[] = [
  { label: 'React bindings', to: 'production/client' },
  { label: 'HTTP API and webhooks', to: 'production/http' },
  { label: 'OpenTelemetry tracing', to: 'production/tracing' },
  { label: 'A scheduler that fakes time in tests', to: 'guide/test' },
  { label: 'Child wizards', to: 'guide/children' },
]

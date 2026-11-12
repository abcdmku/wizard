/**
 * `@openwizard/dev` is a local dev environment for wizards. `openwizard dev` loads the wizards
 * a file exports and serves a browser UI that shows each one, starts runs and lets a person
 * fill in every form, send every event, answer every service call and skip every timer.
 *
 * @packageDocumentation
 */

export {
  type DevConfig,
  type DevWizard,
  defineDev,
  devWizard,
  type EventSource,
} from './config'
export { type DevServer, type DevServerOptions, startDevServer } from './server/server'
export type {
  Action,
  ActionResult,
  Catalog,
  Pending,
  RunDetail,
  RunSummary,
  Services,
  StartRequest,
  WizardInfo,
} from './wire'

# Changelog

## Unreleased

### Breaking changes

- Reordered factory generic parameters so default error is second:
  - `createWizardFactory<Context, DefaultError, Event>()`
  - `createReactWizardFactory<Context, DefaultError, Event>()`
- Previous order was:
  - `createWizardFactory<Context, Event, DefaultError>()`
  - `createReactWizardFactory<Context, Event, DefaultError>()`

### Migration

- Old: `createWizardFactory<MyContext, never, Error>()`
- New: `createWizardFactory<MyContext, Error>()`
- If you use events: `createWizardFactory<MyContext, Error, MyEvent>()`

### Improvements

- Added richer IntelliSense/JSDoc for:
  - `createWizardFactory`
  - `createReactWizardFactory`
  - factory `step<Data, StepError = DefaultError>(...)`
- Expanded docs with step-typing guidance for both factory and standalone helper APIs.

# Contributing

OpenWizard is a pnpm workspace. You need Node.js 20 or newer and pnpm 10.

## Set up the repository

```sh
pnpm install
pnpm build
pnpm test
```

## Make a change

1. Add or update a test next to the package you changed.
2. Run the narrow package test while you work.
3. Run the repository checks before opening a pull request.
4. Add a changeset for a user-visible package change.

Examples of narrow checks:

```sh
pnpm --filter @openwizard/core test
pnpm --filter @openwizard/react test
pnpm --filter example-01-happy-path check
pnpm --filter @openwizard/docs check
```

Run the main repository checks:

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm check:api
pnpm check:docs
```

`pnpm release:check` runs the longer package, size, export, example, and documentation checks used before publishing.

## Find the right code

| Folder | Contents |
|---|---|
| `packages/core` | Flow definitions, runtime, state, persistence, mirrors, and tests |
| `packages/react` | React bindings |
| `packages/devtools` | React inspection tools |
| `packages/durable` | Leases, fenced writes, and durable run hosting |
| `packages/drizzle` | PostgreSQL and SQLite durable stores |
| `packages/effect*` | Effect task adapters |
| `packages/opentelemetry` | Run tracing |
| `packages/webhooks` | Signed webhooks and HTTP resources |
| `packages/docs` | Public documentation site and checked snippets |
| `examples` | Runnable projects and their tests |

## Change the docs

Write for someone who has not used a workflow engine before. Introduce one idea at a time and use a complete example before adding options.

Code fences with `file="..."` load the named repository file during the docs build. Put reusable examples in `packages/docs/snippets` and make sure they type-check.

Run both checks after changing docs:

```sh
pnpm --filter @openwizard/docs check
pnpm check:docs
```

## Add a changeset

```sh
pnpm changeset
```

Choose only the published packages whose public behavior changed. Documentation-only changes usually do not need a package release.

See [RELEASING.md](./RELEASING.md) for the maintainer release process.

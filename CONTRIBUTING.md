# Contributing

OpenWizard is a pnpm workspace. You need Node.js 22 or newer and pnpm 10. The published packages run on Node.js 20.

## Set up the repository

```sh
pnpm install
pnpm build
pnpm test
```

## Make a change

1. Add or update a focused test for changed behavior or a type contract.
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
| `packages/core` | Wizard definitions, runtime, state, persistence, mirrors, and tests |
| `packages/react` | React bindings |
| `packages/devtools` | React inspection tools |
| `packages/durable` | Leases, fenced writes, and durable run hosting |
| `packages/drizzle` | PostgreSQL and SQLite durable stores |
| `packages/effect` | Effect task adapters |
| `packages/opentelemetry` | Run tracing |
| `packages/http` | Generated HTTP API, signed webhooks, outbound callbacks, browser client |
| `packages/docs` | Public documentation site and checked snippets |
| `examples` | Runnable projects and their tests |

## Change the docs

Write for someone who has not used a workflow engine. A page teaches one idea, in this order:

1. The title, then one sentence that says what the reader will be able to do.
2. A complete example, loaded from a tested file with a `file="packages/docs/snippets/..."` fence. Keep it under about 30 lines.
3. Three to six short statements or one small table. Cut a sentence that would not change what the reader types.
4. At most three links: the next page and the reference entry.

State each fact once in the site and link to it from other pages. Option lists belong on the reference pages in `packages/docs/pages/reference`. Word budgets, not counting code and tables: 200 for the Quickstart, 250 for a Guide page, 350 for a Production page.

Every snippet a page shows needs a test in `packages/docs/snippets` that asserts the result the page states. Write snippets the way `snippets/agents/refund.ts` is written: `needs` for hand-offs and `deps` for services. The `_meta.json` file of each folder in `packages/docs/pages` sets the order and titles of the navigation.

`README.md` and `packages/core/AGENTS.md` copy snippet files into fences with `title="..."`. After you change one of those files, run `node scripts/check-readme-quickstart.mjs --write README.md packages/core/AGENTS.md`. The export tables in the package READMEs come from `pnpm docs:gen`. Edit the doc comments in the source, not the tables.

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

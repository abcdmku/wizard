# Working in this repository

OpenWizard runs typed wizards and workflows in TypeScript. This file is for coding agents changing the repository. To write, change or explain a wizard, read [packages/core/AGENTS.md](packages/core/AGENTS.md) first. It holds the authoring model, the rules and a tested example.

## Commands

Node.js 22 or newer and pnpm 10. The build tools need Node.js 22, and the published packages run on Node.js 20.

```sh
pnpm install
pnpm build                              # packages must be built before examples and API checks
pnpm --filter @openwizard/core test     # one package while you work
pnpm typecheck && pnpm lint && pnpm test
pnpm check:api && pnpm check:docs
pnpm --filter @openwizard/docs check    # snippets, links and the docs build
pnpm examples
```

`pnpm release:check` runs everything used before publishing.

## Where things are

| Folder | Contents |
|---|---|
| `packages/core/src/authoring` | `defineWizard`, step config types, the compiler that validates a definition |
| `packages/core/src/machine` | The pure state machine. It decides and applies events and performs no I/O |
| `packages/core/src/interpreter` | Runs hooks, timers and child runs for the machine |
| `packages/core/src/wizard` | The `Run` API, snapshots, resume and wire commands |
| `packages/core/src/inspect` | `inspect`, `toMarkdown`, `toMermaid`, `toJSONSchema`, `formatTrace` |
| `packages/core/src/projection`, `mirror` | Client-safe state and the client replica |
| `packages/react`, `devtools` | React bindings and inspection UI |
| `packages/durable`, `drizzle` | Leases, fenced writes, PostgreSQL and SQLite stores |
| `packages/http`, `effect`, `opentelemetry` | HTTP API and webhooks, Effect adapters, tracing |
| `packages/docs` | The docs site. `snippets/` holds the code the pages show, type-checked and tested |
| `examples`, `systems` | Runnable projects and four larger reference systems |
| `api/*.d.ts` | Snapshots of every public declaration, compared in CI |
| `docs/design` | Architecture plan, machine spec and decision records |

## Rules

The first five come from `docs/design/architecture-plan.md`.

- One authoring path, `defineWizard`, and one live run type, `Run`. Do not add an alias or a second argument shape. Rename or replace instead.
- Step constructors take one object. Every field needs a runtime reader, and every reader needs its field in the type. The wizard header compiled a `description` that no type allowed.
- One type extractor per concept. Application code should not need positional generics.
- Keep files near 400 lines or fewer. Split a file before adding another execution path to it.
- Test what a user sees and the type contracts. Type contracts live in `*.test-d.ts` files.
- Every exported symbol needs a TSDoc comment tagged `@public` and a row in the generated export table.
- Doc comments name the public API: `wizard.create`, `wizard.resume`, `defineWizard`. Internal constructors and version notes do not belong in them, because they ship in the declarations people and agents read.
- Save files as UTF-8. Several comments had been double-encoded and shipped as garbled text in `api/core.d.ts`.

## After a change

| You changed | Then run |
|---|---|
| A public type or doc comment | `pnpm build && pnpm check:api:update`, and review the diff under `api/` |
| An export or its summary line | `pnpm docs:gen` |
| A file under `packages/docs/snippets` that a Markdown file shows with `title="..."` | `node scripts/check-readme-quickstart.mjs --write README.md packages/core/AGENTS.md` |
| Behaviour a user can see | `pnpm changeset`, choosing only the packages whose behaviour changed |

Add or update a focused test for changed behaviour or a changed type contract before the change itself.

## Docs

Write for someone who has not used a workflow engine. Use `defineWizard(options, ({ step, steps }) => steps(map))` in examples. Code fences with `file="..."` load that repository file during the docs build, so put examples in `packages/docs/snippets` and test them there.

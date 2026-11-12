# OpenWizard documentation

The pages live in [`pages`](./pages). A code fence with a `file` attribute loads its content from a tested file under [`snippets`](./snippets).

| Section | Folder | Read |
|---|---|---|
| Quickstart | `pages/quickstart.mdx` | [Quickstart](./pages/quickstart.mdx) |
| Guide | `pages/guide` | [Steps](./pages/guide/index.mdx), then the next nine pages in order |
| Production | `pages/production` | [Production checklist](./pages/production/index.mdx) |
| Reference | `pages/reference` | [Packages](./pages/reference/index.mdx) |
| Examples | `pages/examples.mdx` | [Examples](./pages/examples.mdx) |

## Run the site

From the repository root:

```sh
pnpm install
pnpm build
pnpm docs:dev
```

The site opens at `http://localhost:3000`.

## Check a change

```sh
pnpm --filter @openwizard/docs check
pnpm check:docs
```

The first command type-checks the snippets, runs their tests, checks internal links and builds every page. The second checks the export tables, the imports in code fences and the root quickstart.

While you write, run one check at a time:

```sh
pnpm --filter @openwizard/docs exec tsc --noEmit -p tsconfig.test.json
pnpm --filter @openwizard/docs check:snippets
pnpm --filter @openwizard/docs check:links
```

## Move or rename a page

Add the old route to [`lib/redirects.mjs`](./lib/redirects.mjs). The build writes a redirect page there, and `check:links` fails when a redirect leads nowhere.

## What the build adds

`pnpm --filter @openwizard/docs build` writes the site to `dist/client`. After the pages it adds the search index, the TypeDoc reference, the redirect pages, and `llms.txt` and `llms-full.txt`, which are generated from `pages`. It fails when a docs page loads the playground's editor.

[CONTRIBUTING.md](../../CONTRIBUTING.md#change-the-docs) has the rules for writing a page.

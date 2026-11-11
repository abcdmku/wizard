# OpenWizard documentation

The public guides live in [`pages`](./pages). Code blocks with a `file` attribute load their content from real TypeScript files under [`snippets`](./snippets) or [`examples`](../../examples).

## Run the site

From the repository root:

```sh
pnpm install
pnpm build
pnpm docs:dev
```

The local site opens at `http://localhost:3000`.

## Check a change

```sh
pnpm --filter @openwizard/docs check
pnpm check:docs
```

The first command type-checks the site and snippets against package source, runs snippet tests with the same source aliases, checks internal links, builds every page, and generates TypeDoc. The second checks documented package exports, imports in code fences, and the root quickstart.

During a code change, run focused checks without building the site:

```sh
pnpm --filter @openwizard/docs exec tsc --noEmit -p tsconfig.test.json
pnpm --filter @openwizard/docs check:snippets
pnpm --filter @openwizard/docs check:links
```

Start reading at [getting started](./pages/getting-started.mdx). The [advanced path](./pages/advanced/index.mdx) explains recovery, graph execution, durability, event routing, projections, and replay from tested source.

# @openwizard/docs

The documentation site (private): landing page with a live IDE, guides, the examples with their
sources, the API reference and a playground that runs every example in the browser against the
real, BUILT `@openwizard/core`. Deployed to GitHub Pages by `.github/workflows/deploy-docs.yml`.

```sh
pnpm build                              # the docs consume packages/*/dist (types + runtime)
pnpm docs:dev                           # http://localhost:3000
pnpm docs:build                         # packages/docs/dist/client (prerendered + Pagefind + TypeDoc)
pnpm --filter @openwizard/docs check    # tsc + check-links + build (what CI runs on ubuntu / node 22)
```

## Layout

| Path | What |
|---|---|
| `pages/**/*.mdx` + `_meta.json` | Content and navigation order. A fenced block with `file="examples/…"` embeds that repository file at build time (`lib/remark-plugins.mjs`); markdown imported from the repo (READMEs, `docs/design`) keeps its links working. |
| `src/routes` | TanStack Start file routes: `/` (landing), `/playground`, `/$` (every MDX page). |
| `src/components/playground` | The IDE: Monaco (trimmed bundle, self-hosted workers, the built `index.d.ts` + real `zod` types as extra libs), the runner (TS worker emit → blob ES modules → real `@openwizard/core`), the Graph / Trace / Explain / Console panes. |
| `lib/` | Build-time helpers shared by `vite.config.ts` and `scripts/`: the manifest, the Vite virtual modules, the remark plugins. |
| `scripts/` | `check-links.mjs` (internal links and `_splat` slugs), `postbuild.mjs` (Pagefind, TypeDoc, prerender verification). |

Stack: Vite 8, TanStack Start (prerender), MDX 3, Tailwind 4, Shiki via rehype-pretty-code,
`@monaco-editor/react` + `monaco-editor`, Pagefind, TypeDoc, lucide-react.

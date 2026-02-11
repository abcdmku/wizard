# Docs Parity Report (Core + React)

## Scope

- Packages: `@wizard/core`, `@wizard/react`
- Docs surfaces:
  - `packages/docs/pages/**/*`
  - `README.md`
  - `packages/core/README.md`
- Excluded in this pass: `@wizard/dag-core`, `@wizard/dag-react`

## Export Coverage Matrix

| Package | Export source | Export count | API page strategy |
| --- | --- | ---: | --- |
| `@wizard/core` | `packages/core/src/index.ts` | 36 | Curated sections + auto-synced exhaustive export table |
| `@wizard/react` | `packages/react/src/index.ts` | 33 | Curated sections + auto-synced exhaustive export table |

## Stale-Content Findings

1. Sidebar root switching
- Cause: top-level docs groups were configured with `type: "page"` in `packages/docs/pages/_meta.json`.
- Impact: home sidebar looked sparse and sidebar changed when moving between top-level sections.

2. API reference drift risk
- Cause: API MDX pages were hand-maintained summaries without enforced export parity.
- Impact: missing documented symbols and stale/removed references could reappear.

3. Package README drift
- Cause: `packages/core/README.md` documented old config shape and legacy patterns.
- Impact: examples included outdated APIs (`initialStep`, `initialContext`, `load`-style content, nonexistent `selectors` import).

4. TypeDoc metadata drift
- Cause: stale branding/links in `packages/docs/typedoc.json`.
- Impact: generated docs metadata pointed to outdated identity/URLs.

## Fixes Applied

1. Navigation model
- Updated `packages/docs/pages/_meta.json`:
  - top-level `essentials`, `react`, `advanced` switched to `type: "doc"`
  - unsupported nested `theme.sidebar` config removed
  - valid `theme.collapsed` retained where needed

2. API parity automation
- Added `packages/docs/scripts/sync-api-reference.mjs`
  - parses exports from package entrypoints
  - updates API tables between explicit markers in:
    - `packages/docs/pages/api-docs/core.mdx`
    - `packages/docs/pages/api-docs/react.mdx`
  - supports `--check` mode for CI guardrails

3. Docs guardrail scripts
- Added `packages/docs/scripts/check-doc-imports.mjs`
  - validates all `@wizard/core` and `@wizard/react` named imports across docs + READMEs
- Added `packages/docs/scripts/check-root-meta.mjs`
  - enforces root `_meta.json` ordering and blocks top-level `type: "page" | "menu"`

4. Script wiring
- Updated `packages/docs/package.json`:
  - `sync:api-ref`
  - `check:api-parity`
  - `check:doc-imports`
  - `check:nav`
  - expanded `check` pipeline to run parity/import/nav checks before existing checks

5. Content updates
- Rewrote:
  - `packages/docs/pages/api-docs/core.mdx`
  - `packages/docs/pages/api-docs/react.mdx`
  - `packages/docs/pages/index.mdx`
  - `packages/core/README.md` (concise canonical form)
- Retired stale generator:
  - removed `packages/docs/scripts/generate-api-docs.ts`
- Updated `packages/docs/typedoc.json` branding/links to current repo identity.

## DX Decisions Locked

1. Sidebar behavior
- One global sidebar tree across docs routes.
- No top-level section-tab behavior that changes sidebar root.

2. API references
- Hybrid approach:
  - curated guidance for canonical DX
  - generated exhaustive export map for source truth

3. Compatibility posture
- Compatibility exports remain documented, but explicitly labeled to avoid canonical API confusion.

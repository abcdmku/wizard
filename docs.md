# PRP: Create “docs” package with Nextra (beginner→expert, example-driven)

## Goal

Create a first-class documentation site using **Nextra** (Next.js + MDX) inside the existing pnpm/Nx monorepo. The docs must:

* Serve **entry-level** walkthroughs and **advanced** deep dives.
* Be **example-driven**: every example lives as a **separate app** in `/examples/*` and is referenced/embed-linked in docs.
* Offer **typed API references** generated from source (TSDoc/TypeDoc) with versioned snapshots.
* Include **copy-paste snippets**, **live playgrounds** (where feasible), **architecture diagrams**, and **routing/form/saga** recipes.
* Match TanStack-style tone: headless, minimal deps, type-first.

---

## Deliverables

1. **`/packages/docs`** Nextra site (Next.js 14+), production-ready:

   * Nextra theme config, sidebar nav, search, dark mode.
   * Fast builds, good lighthouse scores, SEO/meta, sitemap/feeds.
2. **Authoring toolkit**:

   * MDX shortcodes/components (Tabs, Steps, Callouts, Collapsible, Badge, CopyButton, CodeSandbox/StackBlitz linkers).
   * Rehype/remark setup for code import from monorepo paths.
3. **Examples integration**:

   * New, scoped **example apps** in `/examples/*` for every major feature.
   * Docs pages import code blocks directly from these example apps, ensuring **no drift**.
4. **Typed API Reference**:

   * `typedoc` pipeline that generates mdx into `/packages/docs/content/api` per package (`@wizard/core`, `@wizard/react`).
   * Stable permalinks, version annotations, source links.
5. **Guides** (beginner → expert), **How-tos**, **Concepts**, **Recipes**, **FAQ**, **Migration**, **Changelog**.
6. **CI**:

   * Lint/Typecheck/Build Docs on PR.
   * Link-checker, code-block compile checks, example build checks.
7. **DX**:

   * `pnpm dev:docs` hot reload.
   * `pnpm docs:build` static export.
   * `pnpm docs:check` (links, examples, typedoc).

---

## Monorepo Changes

### New workspace entries

```
/packages/docs                 # Nextra site
/packages/docs/next.config.mjs
/packages/docs/theme.config.tsx
/packages/docs/nextra.config.ts
/packages/docs/content/**      # mdx tree

/examples/react-router-wizard  # example app (existing or new)
/examples/node-saga-wizard     # example app (existing or new)
/examples/basic-form-wizard    # NEW: minimal form example
/examples/router-guard-wizard  # NEW: guards/redirects
/examples/zod-validation       # NEW: schema wiring
/examples/persistence-local    # NEW: URL/localStorage persistence
/examples/advanced-branching   # NEW: dynamic branching & context
```

### Package.json scripts (root and docs)

**Root**

```json
{
  "scripts": {
    "dev:docs": "pnpm -C packages/docs dev",
    "build:docs": "pnpm -C packages/docs build",
    "start:docs": "pnpm -C packages/docs start",
    "docs:typedoc": "pnpm -C packages/docs run typedoc",
    "docs:check": "pnpm -C packages/docs run check"
  }
}
```

**`/packages/docs/package.json`**

```json
{
  "name": "@wizard/docs",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build && next export",
    "start": "next start",
    "typedoc": "typedoc --tsconfig ../../tsconfig.base.json --options typedoc.json",
    "check": "pnpm run check:links && pnpm run check:examples && pnpm run typedoc",
    "check:links": "markdown-link-check -c .mlc.json 'content/**/*.mdx'",
    "check:examples": "node ./scripts/check-examples-build.mjs"
  },
  "dependencies": {
    "next": "^14.2.0",
    "nextra": "^3.0.0",
    "nextra-theme-docs": "^3.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "typedoc": "^0.26.0",
    "@types/node": "^20.11.0",
    "@types/react": "^18.2.0",
    "remark-gfm": "^4.0.0",
    "rehype-pretty-code": "^0.12.6",
    "markdown-link-check": "^3.11.2"
  }
}
```

### Nextra config & theme

* `theme.config.tsx`: brand, logo, GitHub link, feedback link, edit-this-page, footer with version.
* `nextra.config.ts`: sidebar structure, i18n placeholder, search (local; wire Algolia only if desired).

---

## Authoring Conventions

### Content structure

```
/content
  /getting-started
    index.mdx
    install.mdx
    first-wizard.mdx
  /concepts
    wizard-state.mdx
    shared-context.mdx
    validation.mdx
    transitions-guards.mdx
    persistence.mdx
    events.mdx
  /react
    hooks.mdx
    router-v1.mdx
    start-integration.mdx
  /recipes
    forms-zod.mdx
    router-guards.mdx
    dynamic-branching.mdx
    saga-orchestration.mdx
    url-persistence.mdx
  /examples
    basic-form-wizard.mdx
    router-guard-wizard.mdx
    zod-validation.mdx
    persistence-local.mdx
    advanced-branching.mdx
  /api
    core.mdx
    react.mdx
  /guides
    migration.mdx
    troubleshooting.mdx
    performance.mdx
    testing.mdx
  /about
    philosophy.mdx
    roadmap.mdx
    changelog.mdx
```

### MDX components (shortcodes)

Create `/packages/docs/components/*`:

* `<Callout type="note|tip|warn">`
* `<Steps items={[...]}/>` (or MDX blocks)
* `<Tabs>`/`<Tab>`
* `<Badge>` (Alpha/Experimental)
* `<CopyButton code="..." />`
* `<CodeFrom path="../../examples/basic-form-wizard/src/foo.ts" range="10-40" />` (rehype plugin to inline code from repo)
* `<Playground repo="examples/basic-form-wizard" />` (links to StackBlitz/CodeSandbox with correct directory)

### Code import (no drift)

* Add a simple rehype/remark utility to **inline code blocks from monorepo files** by path + range.
* All snippets in docs must be imported via `<CodeFrom />` or fenced block directive, not hand-copied.

---

## Examples: Apps to Build (each its own `/examples/*`)

1. **`basic-form-wizard`**
   *Audience:* beginners
   *Shows:* createWizard, step data, `next/back`, Zod validate, simple React UI.
   *Docs tie-in:* “First wizard” guide embeds its files via `<CodeFrom />`.

2. **`router-guard-wizard`**
   *Audience:* intermediate
   *Shows:* TanStack Router v1 integration, URL param syncing, `canEnter/canExit`, redirects.

3. **`zod-validation`**
   *Audience:* forms devs
   *Shows:* default Zod adapter, per-step schemas, custom error maps, async validation patterns.

4. **`persistence-local`**
   *Audience:* product devs
   *Shows:* persistence adapter interface, localStorage + URL search param persistence, restore flow.

5. **`advanced-branching`**
   *Audience:* power users
   *Shows:* dynamic branching via `next({ ctx, data })`, complex shared context updates, beforeExit side-effects.

6. **`node-saga-wizard`**
   *Audience:* backend/devops
   *Shows:* CLI/node usage, context mutations across async steps (reserve→charge→email), snapshots.

> Each example must have its own `README.md`, start script, and build passes in CI. Docs pages must embed at least one file from each example and link to run it locally and on StackBlitz.

---

## Page Blueprints (write these)

### Getting Started → First Wizard (beginner)

* Goal, install, minimal code, run.
* Inline `createWizard` with 2 steps; show `updateContext`.
* Add callouts for **strict types**, **validation flow**, **time-travel via history**.

### Concepts → Shared Context (intermediate)

* What is `context: C`; immutability model; `updateContext((ctx)=>{...})`.
* Access patterns in React (`useWizard` + selectors).
* Pitfalls: large context, serialization.
* Example embeds: advanced-branching updates; persistence-local restore.

### Recipes → Router Guards (intermediate)

* Define `canEnter` with auth in ctx; redirect to login step.
* Sync route `<param>` to step; deep link support, back/forward behaviors.
* Example embeds: router-guard-wizard routes + hooks.

### Recipes → Saga Orchestration (advanced)

* Node script that steps a payment flow; persistence adapter to disk/DB.
* Error handling & retries; event hooks; telemetry.
* Example embeds: node-saga-wizard code.

### API → Core / React (reference)

* Generated by TypeDoc; augmented with hand-written “How to read types” notes.
* Cross-links back to Concepts/Recipes.

---

## TypeDoc Pipeline

* Add `typedoc.json` in `/packages/docs` to pull sources from `@wizard/core` and `@wizard/react`.
* Output mdx to `/packages/docs/content/api/*`.
* Include source links to GitHub (monorepo path).
* Keep **human-authored landing** pages in API that link into generated pages.

---

## Visuals & Extras

* Mermaid diagrams for flows (validation→guards→beforeExit→transition).
* Keyboard navigation table (Enter, Backspace, Esc) pattern suggestions.
* Performance notes (selectors, minimal re-renders, store updates).
* Testing section: unit tests for steps, type tests (expectTypeError), React Testing Library examples.

---

## SEO/UX

* Titles, descriptions, canonical URLs.
* OpenGraph images per section.
* JSON-LD breadcrumb.
* Local search (Nextra built-in); optional Algolia config (leave disabled by default, provide template).

---

## CI & Quality Gates

* Build examples on PR (`pnpm -C examples/<name> build`).
* Check that every docs page’s `<CodeFrom />` paths resolve.
* Broken link check.
* Typedoc generation must succeed.
* Lighthouse budget (basic) for docs build.

---

## Commands (Claude Code)

1. **Scaffold**

   * Create `/packages/docs` Nextra app and config.
   * Add MDX components, rehype/remark plugins, code import util.
   * Add initial content skeleton & sidebar.
2. **Examples**

   * Create all example apps with runnable scripts, minimal deps (reuse monorepo libs).
   * Ensure they compile independently.
3. **Integrate**

   * Author core pages; wire `<CodeFrom />` to example sources.
   * Set up TypeDoc → mdx flow; write API landing pages.
4. **Polish**

   * Theme, footer, dark mode, SEO.
   * Add checks and CI workflows.
5. **Verify**

   * `pnpm dev:docs` works; examples run.
   * `pnpm docs:check` passes.

---

## Style & Tone

* Friendly, practical for beginners; precise, type-centric for advanced users.
* Always show **the minimal working snippet** first, then expand.
* Every page: **“Try it now”** box linking to the relevant example’s README and StackBlitz.

---

## Acceptance Criteria

* Docs build and export successfully; sidebar and search work.
* Every major feature has a **runnable example app** referenced by docs via imported code blocks.
* API reference is generated and interlinked.
* At least 2 full beginner flows and 4+ advanced guides with embedded example code.
* CI protects against drift (examples or snippets failing the build).

---

> If any choice is ambiguous, prefer **smaller dependency surface**, **faster builds**, and **type clarity**.

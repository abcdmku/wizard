# @openwizard/docs

The private package that builds the OpenWizard documentation site.

## Run it

From the repository root:

```sh
pnpm install
pnpm build
pnpm docs:dev
```

The site opens at `http://localhost:3000`. Build the packages first because the examples and API
reference use their emitted code and declarations.

Content lives in [`pages`](./pages). Start with
[getting started](./pages/getting-started.mdx). The [API index](./pages/api/index.mdx) links each
package reference and its generated TypeDoc.

Use `pnpm --filter @openwizard/docs check` to typecheck the snippets and site, verify links, and
build the production output.

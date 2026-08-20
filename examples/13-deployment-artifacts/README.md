# 13: Deployment artifacts

This Nitro host builds the same OpenWizard route for Node, AWS Lambda, Azure, Firebase,
Cloudflare Workers, Vercel, and Netlify. Nitro builds the files. Your deployment tool creates the
cloud resources and passes their bindings to the host. Read the
[deployment guide](../../packages/docs/pages/guides/deployment.mdx).

Source: [flow](./src/deployment-probe.ts), [HTTP route](./server/routes/api/runs.post.ts),
[Nitro config](./nitro.config.ts), [artifact builder](./scripts/build-artifacts.mjs),
[test](./src/deployment-probe.test.ts).

## Run

```sh
pnpm --filter example-13-deployment-artifacts start
pnpm --filter example-13-deployment-artifacts build:artifacts
pnpm --filter example-13-deployment-artifacts check
```

Generated output is written under `examples/13-deployment-artifacts/artifacts/`.

# Example 13: deployment artifacts

Build one Nitro host for Node and several serverless providers.

```sh
pnpm --filter example-13-deployment-artifacts check
```

`src/deployment-probe.ts` defines the small flow used to verify each build. `server/routes/api/runs.post.ts` creates a run behind an HTTP route. `scripts/build-artifacts.mjs` builds and checks every provider preset.

Use `pnpm --filter example-13-deployment-artifacts dev` to run the local Nitro server.

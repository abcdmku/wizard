# Example 13: deployment artifacts

Build one Nitro host for Node and several serverless providers.

```sh
pnpm --filter example-13-deployment-artifacts check
```

`src/deployment-probe.ts` defines the wizard used to verify each build. It validates the request, calls `deploymentProbe.run(request)`, and returns the outcome after the run is disposed. `server/routes/api/runs.post.ts` exposes it through an HTTP route. `scripts/build-artifacts.mjs` builds and checks every provider preset.

Use `pnpm --filter example-13-deployment-artifacts dev` to run the local Nitro server.

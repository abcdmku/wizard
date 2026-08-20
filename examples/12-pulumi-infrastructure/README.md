# 12: Pulumi database binding

This optional Pulumi program reads a database dialect and URL from stack configuration. It
validates the dialect and keeps the URL secret in Pulumi outputs. It does not create a database,
open a Drizzle connection, or run migrations. Read
[Drizzle durability](../../packages/docs/pages/integrations/drizzle.mdx) and the
[deployment guide](../../packages/docs/pages/guides/deployment.mdx) first.

Source: [binding](./src/database-binding.ts), [Pulumi program](./src/index.ts),
[test](./src/database-binding.test.ts).

## Run

```sh
pnpm --filter example-12-pulumi-infrastructure check
pnpm --filter example-12-pulumi-infrastructure start
```

The `start` command runs `pulumi up` and requires a Pulumi stack with `databaseDialect` and the
secret `databaseUrl` configured.

Next: [13: Deployment artifacts](../13-deployment-artifacts).

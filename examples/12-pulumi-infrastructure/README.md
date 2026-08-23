# Example 12: Pulumi resources

Bind database resources to an OpenWizard deployment with Pulumi.

```sh
pnpm --filter example-12-pulumi-infrastructure check
```

`src/database-binding.ts` validates provider-specific database bindings. `src/index.ts` declares the Pulumi program.

`pnpm --filter example-12-pulumi-infrastructure start` runs `pulumi up` and may create cloud resources. Review the Pulumi program, choose a stack, and configure credentials before running it.

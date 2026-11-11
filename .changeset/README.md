# Changesets

Every user-facing change to a publishable package under `packages/*` needs a changeset:

```bash
pnpm changeset
```

Pick every affected package and the correct bump type. Write one or two concrete sentences for
the changelog. `core` and `react` share a fixed version group. Other packages can release
independently.

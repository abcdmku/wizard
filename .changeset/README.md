# Changesets

Every user-facing change to `@openwizard/core` or `@openwizard/react` needs a changeset:

```bash
pnpm changeset
```

Pick the packages, the bump type (`patch` while pre-1.0 unless the API changes shape), and write one or two sentences a user of the library would want to read in the changelog. `core` and `react` are versioned together (fixed group).

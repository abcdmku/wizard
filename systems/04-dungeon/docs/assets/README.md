# Dungeon evidence captures

These browser captures were recorded on August 24, 2026, from the current API
and web images during a passing browser gate:

```sh
pnpm ci:browser
```

`pnpm ci:browser` passed the two-player and four-player journeys sequentially.
Only the canonical two-player run writes these screenshots. The four-player run
leaves them untouched and confirms the supported upper party size.

- `dungeon-lobby.png` shows the owner's view of both authenticated players
  before the ready check.
- `dungeon-bound-key.png` shows the owner's private bound key alongside the
  teammate's public health and item-count card. The automated journey also
  verifies that the teammate projection cannot serialize the owner's private
  item.
- `dungeon-reconnect.png` shows the owner's view of the shared door still open
  after the test restarts `dungeon-api` and receives a fresh authoritative
  snapshot.

The complete reproducible sequence is:

```sh
docker compose up --build -d
pnpm seed
pnpm ci:integration
pnpm ci:browser
```

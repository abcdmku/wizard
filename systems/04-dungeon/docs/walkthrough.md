# Dungeon walkthrough

This is the shortest end-to-end check for the reference system.

## Start

```sh
cp .env.example .env
docker compose up --build
```

In a second terminal. The command prints short-lived browser tickets:

```sh
pnpm seed
pnpm health
```

Keep the first terminal open so API and WebSocket logs are visible.

## Play the room

Open the printed `player-one` and `player-two` URLs in separate windows.

1. The first URL identifies `player-one` and the second identifies
   `player-two`. Tickets are signed for the seeded party and expire after ten
   minutes.
2. Join the starter room and mark both players ready. The room should move from
   `lobby` through `generated` into `exploration`.
3. Move player one to the bound key. Pick it up and inspect the private
   inventory. The item must show its player binding.
4. Send the pickup or use command from player two. The server rejects it. The
   second player's inventory and the world sequence do not change.
5. Use the key from player one on the locked door. The next frame shows the door
   open. Repeating the command with the same `commandId` returns the original
   result.

## Restart check

In a third terminal, restart only the API:

```sh
docker compose restart dungeon-api
pnpm health
```

Reconnect both windows. The key owner and door state must match the state from
before the restart. If the key can be picked up a second time, inspect the
command table and the transition transaction before changing client code.

## Browser evidence

The browser receives `/ws` frames with a monotonic `sequence`. The rendered
world intentionally lags the latest receive time by 120 ms. This makes a short
network hiccup less visible while keeping the server in charge. The private
inventory is not copied into the public player list.

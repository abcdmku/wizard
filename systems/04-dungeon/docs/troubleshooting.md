# Dungeon troubleshooting

## Compose does not start

Run `docker compose config` from this directory. If a host port is taken, copy
`.env.example` to `.env` and change `DUNGEON_WEB_PORT`, `DUNGEON_API_PORT`, or
`DUNGEON_POSTGRES_PORT`. The API's internal port stays 8080.
The browser WebSocket uses same-origin `/ws`, so changing `DUNGEON_WEB_PORT`
does not require a second browser URL override.

The Node helpers and test wrappers load `.env` automatically. An exported
variable wins over the file. Set `DUNGEON_ENV_FILE` when the configuration lives
elsewhere.

If a previous run left stale state, use the scoped reset:

```sh
pnpm reset
docker compose up --build
```

## API health stays red

Inspect the dependency first:

```sh
docker compose ps
docker compose logs postgres dungeon-api
```

The API waits for `pg_isready` and its migrations. A bad database password or
an old volume causes a startup loop. `pnpm reset` removes only the named
Dungeon volume, then a new `pnpm seed` restores the fixtures.

## Seed fails

The API must be healthy before `pnpm seed`. Check `DUNGEON_API_PORT` and
`DUNGEON_SEED_KEY`. The script posts to `/seed` with the `X-Seed-Key` header.
Set `DUNGEON_SEED_ENDPOINT` when running a server
with a different local route.

## The page loads without a live room

Check the browser network log for `/ws` and `/api` requests. The web container
proxies those paths to `dungeon-api:8080` on the private network. A browser
cannot resolve that container name directly. Use `http://localhost:4400` in the
browser and leave the proxy enabled.

## A player can use another player's key

Capture the command request and the next frame. The server must derive the
player from the token, compare it with the item's binding, and reject the
transition before writing a command result. Do not fix this by hiding the item
in the UI. Run the player-bound key integration test after changing the rule.

## Tests leave containers behind

The integration runner removes its temporary volume by default. Set
`DUNGEON_KEEP_STACK=1` when collecting logs, then finish with:

```sh
# Copy the exact DUNGEON_INTEGRATION_* command printed by the runner.
DUNGEON_INTEGRATION_PROJECT='openwizard-dungeon-integration-<run-id>' \
DUNGEON_INTEGRATION_DB_VOLUME='openwizard-dungeon-integration-<run-id>' \
DUNGEON_INTEGRATION_NETWORK_NAME='openwizard-dungeon-integration-<run-id>' \
pnpm reset:integration
```

Do not use `pnpm reset` here: it targets the main development project and its
documented volume. Do not run `docker system prune` for a Dungeon test failure.

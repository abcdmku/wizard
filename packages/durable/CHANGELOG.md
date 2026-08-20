# @openwizard/durable

## 0.1.0-next.0

### Minor Changes

- Add the durable storage and coordination contract with leases, fencing tokens,
  snapshot CAS, command and event dedupe, timer claims, a linearizable in-memory
  adapter, retention hooks, and the opt-in `createDurableRun` /
  `resumeDurableRun` host integration. The host is at-least-once and makes no
  exactly-once task guarantee; normal `createRun` and core `Store` remain
  single-owner APIs.

### Patch Changes

- Updated dependencies
- Updated dependencies
- Updated dependencies [0a488d0]
  - @openwizard/core@0.1.0-next.0

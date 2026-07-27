# Meta D1 Concurrent Generated Config Race Hotfix

## Incident

Facebook Lark metadata preflight passed repeatedly, while Meta D1 read-only preflight stopped before any Remote mutation with alternating malformed JSON/JSONC errors.

The D1 preflight builds the Safe and Active Worker bundles concurrently. The underlying operator names each generated config with only the process ID and `Date.now()`. Both calls can occur within the same millisecond, producing the same path. Concurrent writes then race and the compatibility layer may read a partially overwritten config.

## Correction

- Run the guarded Meta D1 fast-track through a launcher-only preload that makes `Date.now()` strictly monotonic inside the operator child process.
- Preserve wall-clock ordering while guaranteeing a unique timestamp suffix for every generated config path.
- Keep the existing operator, confirmations, compatibility path rebasing and Wrangler argument normalization authoritative.
- Require the guarded Remote runbook to use `scripts/meta-d1-only-rollout-launcher.mjs` rather than invoking the internal operator directly.
- Add focused regression proving strictly increasing timestamps and unique generated config names under same-millisecond calls.

## Safety

Repository implementation only. No Remote D1 query/write, Queue/DLQ message, Worker deployment, Meta Provider request, Lark record/schema mutation, Schedule change, Secret change or Production action is performed or authorized.

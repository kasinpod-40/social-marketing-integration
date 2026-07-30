# WooCommerce Final Queue Topology Hotfix v1

## Incident

Static review after the completed-cleanup validator fix found that the reviewed Final operator verifies Queue consumers with legacy fields:

```text
settings.max_batch_size
settings.max_batch_timeout
```

Current Wrangler/Cloudflare consumer JSON uses:

```text
settings.batch_size
settings.max_wait_time_ms
```

Without compatibility normalization, the next Final deployment verification could reject a correct Queue topology before Queue admission.

## Correction

- Keep the reviewed `woocommerce-final-rollout-operator.mjs` implementation byte-for-byte as `woocommerce-final-rollout-operator-core.mjs` using its original Git blob.
- Replace the public entry path with a short wrapper that resolves the real `npx`, creates a private temporary proxy executable outside the Repository and delegates to the immutable core.
- Proxy only the exact command `wrangler queues consumer list <queue> --json`.
- Pass every other `npx` command and stdout/stderr through unchanged.
- Normalize modern `batch_size` to legacy `max_batch_size`.
- Normalize modern `max_wait_time_ms` to whole seconds in `max_batch_timeout`.
- Preserve modern fields and reject modern/legacy conflicts.
- Remove the temporary proxy in `finally`.

## Fail-closed contract

The adapter rejects:

- invalid JSON or unsupported result containers;
- missing required consumer fields;
- duplicate or ambiguous Queue identities;
- conflicting modern and legacy aliases;
- non-integer or negative numeric fields;
- `max_wait_time_ms` values that do not resolve to whole seconds;
- topology values that differ from the approved main Queue or DLQ contract.

## Verification

```text
Current modern consumer shape
Legacy consumer shape
Matching mixed aliases
Conflicting mixed aliases
Direct array / result / consumers containers
Exact CLI-command matching
Immutable core Git-blob identity
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification CI
```

## Safety

Implementation and CI perform no Remote D1/Lark mutation, Worker deployment, Queue/DLQ send, Provider request, Schedule change, Meta execution, Secret change or Production action. The previous Live attempt remains stopped before new WooCommerce operation admission, and Meta remains unstarted.

# WooCommerce Worker Fetch Receiver Hotfix

## Live evidence — 2026-07-29

Read-only inspection of existing operation `woo-final-full-e486b03cfe8d` on merged
`main@294e48807963478c75381db66969f3efbdd8a8e6` returned:

```text
decision                 TERMINAL_FAILED
staleActiveFailure       true
sync_run_error_code      WOOCOMMERCE_NETWORK_ERROR
resource                 system_status
timeoutMs                45000
elapsedMs                0
networkCause.name        TypeError
networkCause.message     Illegal invocation: incorrect this reference
active_lock_count        0
coverage_run_count       0
all Commerce rows        0
```

The zero-millisecond failure proves the request never reached the WooCommerce origin.
Cloudflare documents this error as a method invocation whose required `this` receiver was lost
or replaced.

## Root cause

`WooCommerceRestClient` receives the Worker runtime `globalThis.fetch` and stores it on the
client instance. Calling that function as `this.fetchImpl(...)` supplies the client instance as
the method receiver. Cloudflare runtime `fetch` requires its runtime receiver and therefore
throws `Illegal invocation` before issuing the subrequest.

## Repository correction

The dedicated WooCommerce Worker router now creates a context-safe fetch adapter:

```text
capture runtime fetch method
→ invoke through Reflect.apply(fetchImpl, runtimeGlobal, args)
→ inject adapter into existing WooCommerceRestClient
```

The hotfix does not change:

- credentials or Authorization transport;
- WooCommerce endpoint or API version;
- timeout, retry or pagination policy;
- Queue operation identity or continuation contract;
- Reliability, lock, DLQ or recovery engines;
- D1, Coverage or Lark write contracts;
- schedules, secrets or production state.

## Regression

A focused test uses a receiver-sensitive fake runtime method and proves the adapter preserves
its exact target as `this`. A second test verifies fail-closed behavior when runtime fetch is
unavailable.

## Remote boundary

Repository implementation performs no Provider request, Worker deployment, Queue/DLQ action,
Remote D1 query or mutation, Lark request or mutation, Schedule change, Secret change or
Production action.

After exact-head CI and authorized merge:

1. recover only the exact stale-active work through the existing guarded failed-work recovery;
2. deploy the reviewed Worker version under the existing guarded final operator;
3. admit a new operation only after recovery and rollout preflight pass;
4. keep automatic safe restore and Schedule disabled;
5. require full reconciliation, idempotent rerun and incremental validation before closeout.

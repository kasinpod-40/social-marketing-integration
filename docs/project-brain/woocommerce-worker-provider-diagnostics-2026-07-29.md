# WooCommerce Worker Provider Diagnostics — 2026-07-29

## Authoritative incident state

```text
failed operation       woo-final-full-6f43ac8ee857
sync run status        failed
sync run error         WOOCOMMERCE_INVALID_JSON
durable work           active at failure snapshot
active locks           0
Queue attempts         1
Coverage rows          0
Commerce rows          0
automatic restore      passed
safe Worker version    40ea3319-1da5-4a90-91c1-44d2451f5efd
```

The failed operation must not be automatically resent. A later exact recovery decision remains
separate from Provider diagnostics.

## Evidence added after the incident

PR #228 added bounded invalid-JSON diagnostics to the shared WooCommerce REST client. PR #229
materialized the approved non-secret source values for a local probe. The local probe still could not
run because `WOOCOMMERCE_CONSUMER_KEY` and `WOOCOMMERCE_CONSUMER_SECRET` exist only as deployed Worker
Secrets.

This is an architectural boundary, not another missing configuration field. Deployed Secret values
cannot be exported back into the operator process, and copying them into `.dev.vars` would weaken the
production-like secret boundary.

## Permanent decision

Local WooCommerce Provider diagnostics is unsupported. The retired command returns
`WOOCOMMERCE_LOCAL_PROVIDER_DIAGNOSTICS_UNSUPPORTED` with all counters zero and points to the guarded
Worker-side operator.

The supported implementation reuses:

- the existing WooCommerce REST client and invalid-JSON evidence contract;
- the existing receiver-safe Worker fetch adapter;
- the shared HTTP composition boundary;
- the existing operator bearer token and timing-safe comparison;
- Worker runtime-version metadata and Cloudflare exact-version override;
- the existing Final source-contract materializer;
- the established audit-window pattern: disabled `404`, active unauthenticated `401`, authenticated
  GET, then disabled `404` again.

No new Queue framework, D1 writer, Lark engine, reliability engine or credential store is introduced.

## Safety design

The active diagnostic Worker config has exactly one true execution-style flag:

```text
MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_HTTP_ENABLED
```

All Connector, D1, Lark, Report, Full-reconciliation, Schedule and unrelated channel flags are false.
The route performs one GET to `system_status` and returns only a bounded result. The operator always
attempts all-false restore after any ambiguous or failed active-window step.

## Execution facts during implementation

```text
Provider request          0
Worker deployment         0
Queue/DLQ                 0
Remote D1 mutation        0
Business/Coverage write   0
Lark request              0
Schedule mutation         0
Secret mutation           0
Production                0
```

## Next decision boundary

1. Exact-head Branch Verification must pass.
2. The implementation PR requires explicit Squash Merge authorization.
3. After merge, live execution requires separate explicit authorization for exactly two Worker
   deployments and one authenticated Provider GET.
4. The diagnostic result must be reviewed before any Final rollout, Queue admission or recovery action.

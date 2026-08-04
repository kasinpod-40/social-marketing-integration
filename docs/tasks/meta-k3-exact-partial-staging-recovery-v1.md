# Meta K3 Exact Partial-Staging Recovery v1

## Status

```text
TARGET                         chemistry_k3
OPERATION                      meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9
WORK_KEY                       meta_ads:chemistry_k3:meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9
SYNC_RUN                       meta:meta_ads:chemistry_k3:meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9
SOURCE_STAGE                   daily
SOURCE_UNITS                   13
SOURCE_ROWS                    1201
SOURCE_PAGE                    13
QUEUE_OPERATION_ROWS           1
MAIN_QUEUE_ATTEMPTS            14
D1_OPERATION_WRITES            0
COVERAGE_WRITES                0
LARK_WRITES                    0
ACTIVE_LOCKS                   0
WORK_LIFECYCLE                 active
WORKER                         verified all-false after failed bounded verification
PRODUCTION                     blocked
SCHEDULE                       disabled
```

## Incident

The fresh July K3 operation was accepted once by Cloudflare Queue. Source staging advanced to
`daily / unit 13 / 1,201 rows`, then the bounded verifier restored the Worker to all-false before
source completion. The sync invocation is recorded as successful with zero records written, but the
D1 phase, Coverage, Lark phase and completion phase were never created.

Two later shell recovery attempts stopped before Remote mutation. Read-only diagnosis proved that
the checkpoint, Queue attempt row, Business counts and Coverage counts remained byte-for-byte
unchanged. Blind Queue resend, replacement operation and lifecycle SQL repair remain forbidden.

## Root cause in Repository

The reviewed direct continuation route and Preview finalizer were bound to the exact Chemistry K2
identity. The generic D1 operator can classify Meta Ads partial staging, but the direct Preview
surface could not admit K3 without a new exact identity binding.

## Implementation

This hotfix reuses the already reviewed K2 direct-continuation engine through an isolated K3 adapter:

- exact K3 immutable identity and checkpoint contract;
- K3-only Preview entrypoint with local Queue suppression;
- exact main Queue attempt guard fixed at `14`;
- D1 and Lark phase-specific all-false flag windows;
- Worker version/attestation and ephemeral bearer checks;
- loader adapter that binds the reviewed finalizer modules to the K3 contract without modifying the
  K2 operation or widening the generic Production route;
- focused tests for route identity, Queue suppression, attempt drift and plan wiring.

## Safety contract

- no Cloudflare Queue message from the direct continuation route;
- no `queue_operation_attempts` mutation;
- no replacement operation, lifecycle SQL repair or deletion;
- no Worker deployment or Production traffic change;
- Preview version upload only during separately confirmed execution;
- all-false Preview close after D1 and Lark windows;
- Production active version must remain unchanged;
- Schedule and Production remain disabled;
- any identity, checkpoint, Queue-attempt, Work, Lock, Business-count or Coverage drift fails closed.

## Required gates

```bash
npm ci
npm run check
node --test tests/application/meta-k3-exact-partial-staging-recovery.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Live execution is forbidden until both exact-head GitHub workflows pass. After any non-zero Live
exit, automatic retry is forbidden and a new read-only diagnosis is required.

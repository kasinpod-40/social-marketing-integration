# Meta K3 Exact Partial-Staging Recovery v3

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
D1_OPERATION_WRITES            0 before v3 recovery
COVERAGE_WRITES                0 before v3 recovery
LARK_WRITES                    0 before v3 recovery
ACTIVE_LOCKS                   0
WORK_LIFECYCLE                 active
IMPLEMENTATION                 dedicated K3 finalizer / proven K2 outer Preview window
PREVIEW_URL_AUTHORITY          validated Wrangler version-upload record
PREVIEW_INGRESS                Cloudflare setting false/false → false/true → false/false
WORKER                         all-false after every retained failed attempt
PRODUCTION                     blocked
SCHEDULE                       disabled
LIVE_V3_RUN                    not executed yet
```

## Incident

The fresh July K3 operation was accepted once by Cloudflare Queue. Source staging advanced to
`daily / unit 13 / 1,201 rows`, then the bounded verifier restored the Worker to all-false before
source completion. The D1 phase, Coverage, Lark phase and completion phase were never created.

Blind Queue resend, replacement operation and lifecycle SQL repair remain forbidden. Every retained
attempt preserved the exact operation, Queue counters and zero-write Business boundary.

## Retained failure history and verified safety

All failures remain forensic evidence. None performed Queue delivery, lifecycle SQL repair, Worker
deployment or Production traffic change.

1. Workers.dev subdomain authority was unavailable locally; stopped before Preview upload.
2. Raw Wrangler config omitted materialized `META_GRAPH_API_VERSION=v25.0`; stopped before Preview
   upload.
3. Nested generated config retained a relative `main`; Wrangler compile stopped before upload.
4. A macOS test compared `/var/...` with canonical `/private/var/...`; local gates stopped.
5. Runtime loader/source rewriting produced an unavailable K3 route; Active and Safe Preview versions
   uploaded, HTTP 404 returned, Safe restore passed and Business mutation remained zero.
6. `.wrangler` local cache triggered evidence admission until the exact transient-directory contract
   was added.
7. Bounded readiness retries repeated the unavailable route; Safe restore passed and Business
   mutation remained zero.
8. The dedicated K3 entrypoint and generated artifact were correct, but the Worker-level Preview URL
   setting remained disabled. `versions upload` created Active and Safe versions while the hostname
   still returned HTTP 404. Safe restore passed; Queue/D1/Lark mutation remained zero.

## Confirmed root causes

Two missing parts caused the repeated 404 failures:

1. K3 initially wrapped K2 with a Node loader that rewrote imports, environment names and Source at
   runtime instead of using a dedicated finalizer.
2. After the loader was removed, K3 still omitted the proven K2 outer Preview window. A version upload
   alone does not establish the reviewed Worker-level Preview ingress when the baseline is
   `workers.dev=false` and Preview URLs are disabled.

These were tooling defects, not Provider, D1, Lark, Queue or operation-state failures.

## Final v3 architecture

The Live call chain now mirrors the complete K2 method that passed:

```text
K3 one-command
→ K3 Preview recovery window
   → verify Production all-false and unchanged
   → read Preview setting baseline false/false
   → enable false/true through Cloudflare API and verify readback
   → upload all-false Safe K3 Preview version
   → probe the exact K3 route with zero Business invocation
   → K3 dedicated finalizer
      → Active D1 continuation and idempotency
      → Safe Preview close
      → Active Lark continuation and idempotency
      → Safe Preview close
   → outer Safe Preview upload
   → restore Preview setting false/false and verify readback
→ K3 exact Preview entrypoint
→ existing shared Meta D1/Lark operators
```

The Active finalizer cannot start until the Safe route probe proves it reached the dedicated K3
handler. HTTP 404, redirect, wrong stage or wrong response code fails before D1/Lark flags are opened.
The outer `finally` always attempts an all-false Safe Preview upload and restores the Preview setting.

Implementation properties:

- dedicated `scripts/meta-k3-partial-staging-preview-finalizer.mjs`;
- dedicated `scripts/lib/meta-k3-partial-staging-finalizer.js`;
- dedicated `scripts/lib/meta-k3-preview-recovery.js`;
- outer `scripts/meta-k3-partial-staging-preview-recovery.mjs` using the proven K2 setting window;
- exact Preview entrypoint
  `apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js`;
- no Node loader, runtime Source replacement or K2 finalizer in the K3 Live call chain;
- materialized Meta Graph and Lark runtime authority;
- Repository-anchored absolute entrypoint and no Preview routes, schedules or Production ingress;
- validated Wrangler `version-upload` record as Preview-origin authority;
- unique bounded Preview alias per run;
- local Queue-suppression stub and unchanged exact Queue attempt counters;
- D1 and Lark completion plus idempotent reruns;
- Production active version and traffic remain unchanged;
- only exact safe-restored evidence profiles may be archived;
- `.wrangler` is the only accepted transient directory; every other directory, symlink or evidence
  drift fails closed.

## Permanent operating rule

1. Start from the complete last Live-successful architecture, including its outer safety window.
2. Change only immutable identity, checkpoint and target-specific scope.
3. Reuse shared D1/Lark/Queue infrastructure directly.
4. Never rewrite Production Source modules during runtime.
5. Generated artifacts and the real ingress sequence must be tested, not only helper functions.
6. Every observed failure becomes a regression before another Live run.
7. A non-zero Live exit forbids automatic rerun until Remote truth and Safe restore are proven.

## Regression matrix

```text
Graph API version materialized                         PASS
Lark mappings materialized                             PASS
Nested config uses absolute Repository entrypoint      PASS
macOS canonical realpath comparison                    PASS
Exact K3 Preview entrypoint compiled                   PASS
Exact Active K3 artifact Wrangler dry-run              PASS
Preview setting baseline false/false required          PASS
Preview setting active false/true required             PASS
Safe Preview upload required before Active finalizer   PASS
Safe route probe accepts exact K3 handler only          PASS
Retained HTTP 404 blocked before Active finalizer       PASS
Exact POST route and direct use-case invocation        PASS
Queue suppression and attempt-drift guards             PASS
Wrangler upload record is URL authority                PASS
No guessed exact recovery URL                          PASS
No loader/source rewrite/K2 finalizer call chain       PASS
Outer Safe upload and false/false restore in finally   PASS
.wrangler transient cache only                         PASS
Unexpected directory/evidence drift rejected           PASS
Production deployment unchanged contract               PASS
```

## Safety contract

- no Cloudflare Queue message from direct continuation;
- no `queue_operation_attempts` mutation;
- no replacement operation, lifecycle SQL repair or deletion;
- no Worker deployment or Production traffic change;
- Preview version uploads only inside the separately confirmed setting window;
- all-false Preview close after D1, Lark and the outer window;
- Production active version must remain unchanged;
- Schedule and Production remain disabled;
- any identity, checkpoint, Queue-attempt, Work, Lock, Business-count, Coverage, route-probe,
  generated-config, Preview-setting or evidence drift fails closed.

## Required gates

```bash
npm ci
npm run check
node --test \
  tests/application/meta-k3-exact-partial-staging-recovery.test.js \
  tests/application/meta-k3-dedicated-finalizer.test.js \
  tests/application/meta-k3-preview-recovery.test.js \
  tests/application/meta-k3-preview-window.test.js \
  tests/application/meta-k3-preview-recovery-window.test.js \
  tests/application/meta-k3-one-command-launcher.test.js \
  tests/application/meta-k3-recovery-resume-boundary.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Live execution remains forbidden until Meta End-to-End Verification and Branch Verification both
pass on the exact final PR Head. CI performs no Remote K3 continuation. After any non-zero Live exit,
automatic retry remains forbidden.

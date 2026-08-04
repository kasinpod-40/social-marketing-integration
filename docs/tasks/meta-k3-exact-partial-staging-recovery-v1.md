# Meta K3 Exact Partial-Staging Recovery v2

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
D1_OPERATION_WRITES            0 before dedicated recovery
COVERAGE_WRITES                0 before dedicated recovery
LARK_WRITES                    0 before dedicated recovery
ACTIVE_LOCKS                   0
WORK_LIFECYCLE                 active
IMPLEMENTATION                 dedicated K3 finalizer / no runtime loader
PREVIEW_URL_AUTHORITY          validated Wrangler version-upload record
WORKER                         all-false after every retained failed attempt
PRODUCTION                     blocked
SCHEDULE                       disabled
LIVE_DEDICATED_RUN             not executed yet
```

## Incident

The fresh July K3 operation was accepted once by Cloudflare Queue. Source staging advanced to
`daily / unit 13 / 1,201 rows`, then the bounded verifier restored the Worker to all-false before
source completion. The sync invocation is recorded as successful with zero records written, but the
D1 phase, Coverage, Lark phase and completion phase were never created.

Blind Queue resend, replacement operation and lifecycle SQL repair remain forbidden. Every later
attempt preserved the exact operation, Queue counters and zero-write Business boundary.

## Retained failure history and verified safety

All failures below are retained as forensic evidence. None performed Queue delivery, lifecycle SQL
repair, Worker deployment or Production traffic change.

1. Workers.dev subdomain could not be derived from retained local evidence. The run stopped before
   Preview upload.
2. The generated config used raw `wrangler.sync.jsonc` without materialized
   `META_GRAPH_API_VERSION=v25.0`. The run stopped before Preview upload.
3. A generated config under `outputs/...` retained a relative `main`, so Wrangler resolved the
   entrypoint from the nested directory. Compile failed before Preview upload.
4. A macOS regression compared `/var/...` with canonical `/private/var/...`. Local gates stopped
   before Preview upload.
5. The adapter path uploaded Active and Safe Preview versions but called an unavailable route and
   received HTTP 404. Safe restore passed; D1/Lark/Queue mutations remained zero.
6. Wrangler created local `.wrangler` cache inside the evidence root. Resume admission stopped before
   Remote action until the exact transient-directory contract was added.
7. A readiness retry repeated the same unavailable route for 60 bounded attempts. Active and Safe
   Preview versions were uploaded, Safe restore passed and Business mutation remained zero.

## Confirmed root cause

K3 did not actually use the same proven architecture as K2. It invoked the K2 finalizer through a
Node loader that rewrote imports, environment names, contracts and Source text at runtime. The
resulting Preview config retained the ordinary Worker entrypoint instead of the dedicated K3 exact
Preview entrypoint, so the K3 route was not present and the derived alias URL returned 404.

This was not a Provider, D1, Lark, Queue or propagation-delay failure. It was an unnecessary runtime
adapter layer that violated the project rule: when a Live method has already passed, reuse that
architecture directly and change only the exact identity/scope.

## Dedicated v2 implementation

The Live call chain is now fixed and explicit:

```text
K3 one-command
→ K3 dedicated finalizer
→ K3 exact Preview entrypoint
→ existing shared Meta D1/Lark operators
```

Implementation properties:

- dedicated `scripts/meta-k3-partial-staging-preview-finalizer.mjs`;
- dedicated `scripts/lib/meta-k3-partial-staging-finalizer.js`;
- dedicated `scripts/lib/meta-k3-preview-recovery.js`;
- exact Preview entrypoint
  `apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js`;
- no Node loader, no runtime Source replacement and no K2 finalizer in the K3 Live call chain;
- materializes the existing Meta Graph/Lark runtime authority before generating Preview config;
- anchors the exact entrypoint to the Repository and removes routes, schedules and Production
  ingress from Preview config;
- uses the validated Wrangler `version-upload` record as Preview-origin authority rather than a
  separately guessed recovery URL;
- performs direct use-case continuation with a local Queue-suppression stub;
- keeps exact Queue attempt counters unchanged;
- performs D1 completion and idempotent rerun before Lark;
- performs Lark parity and idempotent rerun after D1;
- uploads an all-false Safe Preview version in `finally` for both D1 and Lark windows;
- verifies the Production active version and traffic remain unchanged;
- archives only exact previously accepted safe-restored evidence profiles;
- accepts `.wrangler` only as the explicitly reviewed transient cache directory and rejects every
  other directory, symlink or evidence-file drift.

The obsolete files were removed:

```text
scripts/lib/meta-k3-exact-recovery-loader.mjs
scripts/lib/meta-k3-preview-readiness.js
tests/application/meta-k3-preview-readiness.test.js
```

The K3 contract no longer exports K2 compatibility aliases.

## Permanent operating rule

For every future target/account continuation:

1. Start from the last Live-successful architecture, not a wrapper around it.
2. Change only immutable identity, checkpoint and target-specific scope.
3. Reuse shared D1/Lark/Queue infrastructure directly.
4. Never rewrite production Source modules during runtime.
5. Generated artifacts—not only helper functions—must pass their real compile/dry-run path.
6. Every observed failure becomes a regression before another Live run.
7. A non-zero Live exit forbids automatic rerun until exact Remote truth and Safe restore are proven.

## Regression matrix

The dedicated path now locks all previously observed defects:

```text
Graph API version materialized                   PASS
Lark mappings materialized                       PASS
Nested config uses absolute Repository entrypoint PASS
macOS canonical realpath comparison              PASS
Exact K3 Preview entrypoint compiled             PASS
Actual Wrangler versions upload --dry-run        PASS
Exact POST route and direct use-case invocation  PASS
Attested HEAD route without Business invocation  PASS
Queue suppression and attempt-drift guards       PASS
Wrangler upload record is URL authority          PASS
No guessed MKT_META_K3_EXACT_RECOVERY_URL        PASS
No loader/source rewrite/K2 finalizer call chain PASS
.wrangler transient cache only                   PASS
Unexpected directory/evidence drift rejected     PASS
Production deployment unchanged contract         PASS
```

## Safety contract

- no Cloudflare Queue message from direct continuation;
- no `queue_operation_attempts` mutation;
- no replacement operation, lifecycle SQL repair or deletion;
- no Worker deployment or Production traffic change;
- Preview version upload only during separately confirmed execution;
- all-false Preview close after D1 and Lark windows;
- Production active version must remain unchanged;
- Schedule and Production remain disabled;
- any identity, checkpoint, Queue-attempt, Work, Lock, Business-count, Coverage, generated-config or
  evidence drift fails closed.

## Required gates

```bash
npm ci
npm run check
node --test \
  tests/application/meta-k3-exact-partial-staging-recovery.test.js \
  tests/application/meta-k3-dedicated-finalizer.test.js \
  tests/application/meta-k3-preview-recovery.test.js \
  tests/application/meta-k3-one-command-launcher.test.js \
  tests/application/meta-k3-recovery-resume-boundary.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Live execution remains forbidden until Meta End-to-End Verification and Branch Verification both
pass on the exact final PR Head. Implementation and CI perform no Remote K3 continuation. After any
non-zero Live exit, automatic retry remains forbidden.

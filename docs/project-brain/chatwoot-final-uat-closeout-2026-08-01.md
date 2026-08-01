# Project Brain — Chatwoot Final UAT Closeout (2026-08-01)

## Current verified status

The guarded Chatwoot retained-operation recovery completed safely after PR #412 supplied an exact pinned Git origin
for every nested recovery fetch.

Accepted user-supplied Terminal output:

```text
contractVersion         chatwoot-initial-terminal-failure-recovery-v1
status                  completed_safe
marker                  CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
exactLockScopeVerified  true
activeLockCount         0
safeRestoreVerified     true
```

The completed-safe result closes the incident chain that previously required running-unit polling correction,
Queue-attempt exhaustion recovery, controller bearer refresh/resume, Secret-name verification, evidence arbitration
and pinned-origin isolation.

## Permanent lessons

1. Durable Queue work may continue after a local controller exits; controller absence is not proof of terminal Work.
2. A `running` durable unit is pending execution, not a failed unit.
3. Accepted Queue evidence makes reruns verification-only until exact state proves a resend is required.
4. Multiple retained controller evidence directories must be arbitrated by the active Worker deployment identity,
   not timestamps or directory names.
5. Nested exact-main launchers must use a synthetic pinned origin; a source local `main` branch is not a stable
   authority for `git fetch origin main`.
6. Long-running controller reads must refresh expiring Cloudflare authorization without replacing Wrangler's
   refreshable OAuth session.
7. Safe restore ownership must remain explicit and transfer only through reviewed recovery contracts.
8. Successful closeout requires exact D1/Lark parity, replay stability, zero active lock and all-false Worker restore.

## Retired recovery scope

Do not rerun the closed Chatwoot incident operators or manually send/redrive the retained operation. Future Chatwoot
operations require a fresh task, new explicit scope and a read-only proof of the completed-safe baseline.

## Integration sequence impact

Chatwoot no longer blocks the retained Meta Facebook continuation. Meta remains:

```text
D1 phase           complete
Lark phase         pending
Provider replay    forbidden
D1 Queue resend    forbidden
Schedule           disabled
Production         blocked
```

The only retained public Meta authority is `scripts/meta-history-2026-reviewed-release-terminal.mjs`, which delegates
inside the immutable reviewed release to `scripts/meta-history-2026-exact-plan-continuation-terminal.mjs`.

## Report impact

Chatwoot source and parity readiness are now proven sufficiently to begin a Repository-only generic Chatwoot Report
contract workstream. That work must reuse Shared Report materialization, null/zero/Coverage semantics, Stable keys and
the universal Lark writer. Remote Report execution remains separately gated.

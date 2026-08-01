# Chatwoot Final UAT Closeout — 2026-08-01

## Decision

```text
CHATWOOT_FINAL_UAT       = COMPLETED_SAFE
CLOSEOUT_MARKER          = CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
EXACT_LOCK_SCOPE         = VERIFIED
ACTIVE_LOCK_COUNT        = 0
SAFE_RESTORE             = VERIFIED
SCHEDULE_WEBHOOK         = DISABLED
PRODUCTION               = BLOCKED
```

Chatwoot has completed the guarded 30-day Initial plus 3-day Daily sequence from the retained operation. The user
supplied the accepted Terminal completion output after the pinned-origin recovery authority from PR #412 was merged.

## Accepted evidence

The completion output reports:

```text
contractVersion         chatwoot-initial-terminal-failure-recovery-v1
status                  completed_safe
marker                  CHATWOOT_30D_DAILY_UAT_COMPLETED_SAFE
exactLockScopeVerified  true
activeLockCount         0
safeRestoreVerified     true
```

The output shows the retained controller sequence completed and the Worker returned to the all-false Safe state.
This closeout does not independently repeat Remote reads; it records the successful operator result supplied by the
user.

## Retired commands

The following recovery families are retired for this completed incident and must not be run again:

- original Chatwoot Final UAT launcher;
- Initial terminal-failure recovery launcher;
- Queue-exhaustion recovery launcher;
- controller-evidence arbitration wrapper;
- pinned-origin arbitration wrapper;
- manual Queue/DLQ redrive or replacement Initial/Daily admission.

A rerun after completed-safe could duplicate operational intent even when Stable keys remain idempotent. Future
Chatwoot work must start from a new task and prove the completed-safe baseline read-only before any new operation.

## Business and safety invariants

- Existing Chatwoot Business facts and Stable keys remain authoritative.
- No Message content, direct PII, Token or Secret is added to Repository evidence.
- Missing metrics remain `null`; observed zero remains `0`.
- Schedule and Webhook remain disabled.
- Production remains blocked.
- This documentation closeout performs no Provider request, Queue/DLQ action, D1/Lark mutation, Worker deployment,
  Secret change or incident mutation.

## Unblocked next work

Chatwoot no longer blocks the retained Meta Facebook Lark continuation. The preserved Meta operation remains D1
complete and Lark pending, with Provider replay and D1 Queue resend forbidden.

Repository-only Report work may proceed in parallel on isolated branches. Chatwoot Report work must reuse the
completed source tables, Shared Report engine, existing D1 readers and universal Lark writer; it must not introduce a
second Connector, Reliability engine, Queue framework, D1 writer or Lark sync engine.

## Repository verification

```bash
git diff --check
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

All verification is Repository-only and must execute zero Live or Remote mutation.

# Chatwoot Inspector Active Resume Window v1

## Incident

The exact safe-baseline controller selected and materialized one retained evidence identity correctly, promoted the
retained Chatwoot Final UAT Worker version, and delegated to the unchanged Initial terminal recovery launcher.

The recovery inspector then stopped before backup, Work reactivation, Queue continuation, D1/Lark mutation or incident
closure with:

```text
code       CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE
trueFlags  MKT_CONNECTOR_CHATWOOT_ENABLED
           MKT_CHATWOOT_D1_WRITE_ENABLED
           MKT_CHATWOOT_LARK_WRITE_ENABLED
           MKT_CHATWOOT_REPORT_WRITE_ENABLED
```

The safe-baseline parent subsequently verified every execution flag false. Schedule and Webhook remained disabled and
Production remained blocked.

## Root cause

`chatwoot-initial-terminal-failure-inspector.mjs` had one Worker policy only: every `MKT_*_ENABLED` binding had to be
false. That policy is correct for ordinary standalone inspection, but the exact controller-resume path intentionally
promotes the retained four-flag Chatwoot active window before invoking the inspector. The inspector therefore rejected
the exact Worker state already proven and owned by its parent.

## Contract

The inspector accepts exactly two Worker modes:

1. `all_flags_false` — the existing ordinary read-only inspection mode;
2. `exact_safe_baseline_resume_active_window` — only when all conditions below hold:
   - the enabled flags equal the four exported Chatwoot Final UAT flags exactly;
   - no Schedule, Webhook or other execution flag is true;
   - `outputs/chatwoot-controller-safe-baseline-resume/<current-head>/01-active-window.attempt.json` exists as a
     private regular non-symlink file;
   - the attempt passes the existing safe-baseline handoff contract validator for the current repository Head;
   - the current active Worker version SHA-256 fingerprint equals the attempt's retained-active-version fingerprint.

Missing handoff, malformed handoff, version drift, duplicate flags or any extra true flag remain fail closed with
`CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE`.

## Safety

- The inspector remains SELECT-only and performs no Provider, Queue, D1/Lark mutation, deployment or incident closure.
- The recovery launcher and every mutation authority remain unchanged.
- No second Initial admission is allowed.
- The active-window exception is bound to current-head evidence and exact version identity, not caller intent alone.
- All-false Safe restore remains owned by the existing parent/inner recovery chain.
- Schedule and Webhook remain disabled; Production remains blocked.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/chatwoot-initial-failure-worker-safety.test.js
node --test tests/application/chatwoot-initial-terminal-failure-recovery.test.js
node --test tests/application/chatwoot-controller-evidence-arbitration.test.js
node --test tests/application/chatwoot-controller-safe-baseline-resume.test.js
node --test tests/application/chatwoot-controller-safe-baseline-exact.test.js
node --test tests/application/chatwoot-final-30d-daily-uat.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository implementation and CI perform zero Live or Remote mutation.

# Meta K2 Source-Complete Preview Recovery v4

## Status

```text
WORKSTREAM                 = Meta PR #421 Live End-to-End
BRANCH                     = integration/all-meta-end-to-end-completion-v1
RETAINED_OPERATION         = meta-chemistry_k2-history-20260701-20260731-f741090d1d8a
RETAINED_BOUNDARY          = source_complete_pre_d1_failed
V3_RESULT                  = BACKUP_FAILED_SAFE_CLOSED
V4_REMOTE_EXECUTION        = NOT_AUTHORIZED_UNTIL_EXACT_HEAD_CI
SCHEDULE                   = DISABLED
PRODUCTION                 = BLOCKED
```

## Incident evidence retained

The exact v3 attempt passed retained-evidence admission, local gates, Production all-false
verification and the 30-second exact-state stability gate. It then failed at the one-shot
remote D1 export before `backup.json`, before any D1/Lark continuation, and before any
Provider or Queue action.

Wrangler `4.110.0` accepted the non-interactive confirmation fallback, started the remote
export, issued the export and poll requests, then raised an empty-message error inside
`pollExport` after approximately 23 seconds. No SQL output file was created.

The outer failure path uploaded only Safe Preview versions and restored both Preview URLs
and workers.dev to disabled. Production deployment and traffic remained unchanged.

The v3 evidence root and local Wrangler diagnostics are retained without deletion or rename.

## v4 objective

Make the backup boundary independent of the Preview mutation window:

```text
exact repository / CI gate
→ auth and Production all-false readback
→ one explicit remote D1 export
→ private immutable backup evidence
→ only then open Preview URL window
→ Safe Preview bootstrap
→ existing exact D1 continuation
→ Safe close
→ existing exact Lark continuation
→ Safe close and final readback
```

## v4 safety contract

- new explicit confirmation and new immutable v4 attempt roots;
- no automatic backup retry;
- `--skip-confirmation` is explicit, although the v3 failure was not a confirmation failure;
- backup stdout/stderr are retained as private `0600` files;
- failed backup exits before Preview setting mutation and before Worker Version upload;
- finalizer receives the exact retained backup path and cannot call `d1 export` again;
- v3 evidence is never deleted, renamed or overwritten;
- Provider replay, Queue send, replacement operation and lifecycle SQL repair remain forbidden;
- Production deployment/traffic remain zero;
- Schedule/Webhook remain disabled.

## Required verification

```bash
node --check scripts/lib/meta-k2-source-complete-preview-recovery-v4.js
node --check scripts/lib/meta-k2-source-complete-preview-loader-v4.mjs
node --check scripts/meta-k2-source-complete-preview-finalizer-bootstrap-v4.mjs
node --check scripts/meta-k2-source-complete-preview-recovery-v4.mjs
node --test tests/application/meta-k2-source-complete-preview-recovery-v4.test.js
node --test tests/application/meta-k2-source-complete-preview-recovery.test.js
node --test tests/application/meta-k2-source-complete-preview-final-contract.test.js
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Remote execution remains forbidden until Meta End-to-End Verification and Branch Verification
both pass on the exact final PR Head.

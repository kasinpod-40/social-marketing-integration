# Runbook — TikTok Post-Lark Cross-layer Gap Reconciliation

## Entry conditions

Run only after PR `#154` is reviewed, aligned, verified and merged. The command refuses a branch other
than `main` and refuses a dirty working tree.

Required local inputs remain ignored/private:

- `.dev.vars` when present;
- `wrangler.sync.tiktok-rollout-safe.jsonc` or the path set by
  `MKT_TIKTOK_RECONCILIATION_WRANGLER_CONFIG`;
- Cloudflare Wrangler login or `CLOUDFLARE_API_TOKEN`;
- `MKT_CONNECTION_OPERATOR_TOKEN` in Environment or macOS Keychain service
  `MKT Social Marketing Integration`.

The source Wrangler file is read only. The operator creates root-level temporary JSON configs with
mode `0600` and deletes them before exit.

## Plan-only preview

```bash
npm run rollout:tiktok-gap-reconciliation
```

The preview makes no Remote request and prints the execution and safety contract.

## Guarded execution

```bash
CONFIRM_TIKTOK_POST_LARK_RECONCILIATION=EXECUTE_TIKTOK_POST_LARK_RECONCILIATION \
npm run rollout:tiktok-gap-reconciliation:run
```

## Exact execution sequence

1. Parse the ignored safe Wrangler config as JSONC.
2. Materialize a temporary safe config with Version Metadata and every relevant execution flag false.
3. Materialize a temporary reconciliation config with only:
   - `MKT_TIKTOK_AUDIT_HTTP_ENABLED=true`;
   - `MKT_CONNECTOR_TIKTOK_ENABLED=true`;
   - `MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED=true`;
   - `MKT_TIME_SERIES_D1_WRITE_ENABLED=true`.
4. Keep incremental mode, backfill, reports, retention/delete, notifications, DLQ redrive, all schedules
   and all unrelated connectors false.
5. Deploy safe and require three direct no-cache requests returning the exact deployment Version header
   and HTTP `404`.
6. Deploy reconciliation mode and require three direct no-cache requests returning the exact deployment
   Version header and HTTP `401`.
7. Make one authenticated GET and classify the full sanitized Audit.
8. Stop before Queue when the Audit contains any non-additive conflict.
9. For additive gaps only, resolve the exact Cloudflare Account and Queue through the existing shared
   Wrangler/REST discovery path.
10. Send one `tiktok.creator.native.probe` message with trigger `manual_reconciliation`, fixed
    `requestedAt`, and previous completed `Asia/Bangkok` metric date.
11. Poll the exact watermark/date Admission through read-only Remote D1 SQL until `completed`.
12. Run a second authenticated Audit and require the same RAW watermark with zero issues.
13. Resend the exact same probe envelope, wait the bounded settle window, and require the completed
    Admission identity/timestamps to remain unchanged.
14. Run the final Audit again and require zero issues.
15. Deploy safe and attest exact active Version plus HTTP `404` three times.
16. Write sanitized evidence to:
    `outputs/tiktok-post-lark-reconciliation/summary.json`.

## Success output

```text
FINAL_RECONCILIATION_RESULT=PASS_SAFE_CLOSED
RECONCILIATION_MODE=reconciled|already_ready
INITIAL_GAP_CATEGORIES=<count>
INITIAL_MISSING_ENTITY_TOTAL=<count>
FINAL_ISSUE_COUNT=0
RAW_RECORD_COUNT=<count>
QUEUE_MESSAGES_SENT=0|2
IDEMPOTENT_REPLAY=true
SCHEDULES_ACTIVATED=false
RETENTION_OR_DELETE=false
FINAL_ROUTE_STATUS=404
```

Two Queue submissions in `reconciled` mode are intentional: one bounded repair probe and the exact same
probe replay. The second probe must be rejected by durable Admission idempotency without a second
Business sync.

## Emergency behavior

After the operator starts deploying reconciliation mode, every success or failure path attempts an
all-flags-false safe deployment and requires the exact active Version plus `404 × 3`. A safe-close
failure returns `TIKTOK_GAP_RECONCILIATION_SAFE_CLOSE_FAILED` and must be treated as an incident.

Do not rerun after any failure until the sanitized error code and safe-close result are reviewed.

## Rollback

There is no destructive rollback. Reconciliation uses idempotent upsert/create-if-absent contracts in
the existing D1/Lark path. The operational rollback is the final safe Worker deployment only. Existing
Business facts, Admissions, Coverage, checkpoints and forensic evidence must not be deleted.

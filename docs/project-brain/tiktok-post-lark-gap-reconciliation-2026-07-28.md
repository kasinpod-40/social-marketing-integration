# Project Brain — TikTok Post-Lark Gap Reconciliation

Date: 2026-07-28

## Durable runtime truth

The TikTok guarded Final Runtime Audit is complete. It is no longer blocked by Worker version skew or
the Audit HTTP fallback boundary.

```text
SAFE_BASELINE_VERSION               = 2209b3e4-85ec-4425-97f9-85c9d6d8fbd6
AUDIT_ACTIVE_VERSION                = 7fbf35c2-30a1-466e-a12e-66340a0460ce
FINAL_SAFE_VERSION                  = 69659331-b77a-45d4-9053-3a6869847a0a
AUDIT_ACTIVE_ATTESTATION            = exact version / 401 x3
AUTHENTICATED_AUDIT                 = PASS / read_only
RAW_RECORD_COUNT                    = 2024
READY_FOR_MANUAL_PROCESSING         = false
ISSUE_COUNT                         = 3
ISSUE_CODE                          = TIKTOK_CROSS_LAYER_GAP x3
QUEUE_OR_WRITE_DURING_AUDIT         = false
FINAL_SAFE_ATTESTATION              = exact version / 404 x3
```

The terminal output intentionally retained only issue codes, not the exact gap names/counts. Do not
state that the three categories are any specific gap combination until the new full Audit captures
that evidence.

## Durable architecture truth

No new ingestion framework is required. The current repository already owns the complete repair path:

```text
Lark Native TikTok RAW
  → bounded two-read source watermark
  → tiktok_source_admissions
  → existing main Queue
  → staged full reconciliation
  → existing resumable Work/checkpoints
  → D1 Organic History first
  → Canonical MKT_Content / MKT_Content_Daily
  → Coverage completion
```

The reconciliation operator must call that path rather than writing D1 or Lark rows directly.

## Audit bound correction

The Audit previously derived `maxContentRecords=pageSize×maxPages`, which was 500,000 under default
Lark traversal bounds. The D1 Audit adapter deliberately caps materialized Content identities at
50,000. The application use case now clamps the D1 argument to 50,000 while preserving the wider Lark
scan bound.

## Automatic repair policy

Automatic full reconciliation is allowed only when:

- Audit identity is exact `development / integration_workspace / chemistry_k`;
- every issue is `TIKTOK_CROSS_LAYER_GAP`;
- all gap names are from the additive allowlist;
- `contentNotInRaw=0`;
- there are no duplicate/missing Canonical keys;
- there are no D1 duplicate, observation or Coverage integrity issues;
- RAW watermark remains unchanged across before/after/replay Audit.

Any destructive or ambiguous state remains blocked for manual diagnosis. The operator never deletes or
marks historical facts unavailable to make parity pass.

## Version-routing lesson

Cloudflare Version override did not reliably route newly deployed versions during the observed global
convergence window. The proven runtime gate is direct active-deployment attestation:

1. parse the deployment Version ID from Wrangler structured output;
2. make direct cache-busted requests without Version override;
3. require `x-mkt-worker-version-id` to equal the deployment Version;
4. require the expected HTTP status three consecutive times.

Future TikTok rollout controls should prefer this active-deployment gate unless a separate reviewed
Cloudflare deployment strategy changes the contract.

## Safety state during implementation

```text
DRAFT_PR                            = #154
WORKER_DEPLOYMENT                   = NONE
QUEUE_SEND                          = NONE
REMOTE_D1                           = NONE
LARK_MUTATION                       = NONE
MIGRATION                           = NONE
SCHEDULE_CHANGE                     = NONE
PRODUCTION                          = BLOCKED
```

Remote reconciliation remains a post-merge Terminal operation with exact confirmation and automatic
safe-close. Repository implementation does not authorize merge or execution by itself.

# WooCommerce Invalid-JSON Recovery Chain v1

## Incident

Canonical WooCommerce 2026 completion admitted exact operation:

```text
operation_id             woo-final-full-5b56469100a9
sync_run_status          failed
sync_run_error_code      WOOCOMMERCE_INVALID_JSON
work_lifecycle_status    active
active_lock_count        0
queue_operation_attempts 1
```

Automatic all-false Safe restore completed. Meta was not started.

## Proven precedent

The repository already closed the same incident class for `woo-final-full-6f43ac8ee857` by using:

```text
guarded Worker Preview Provider diagnostics
→ exact read-only operation inspection
→ one lifecycle-only stale-work recovery
→ new Final rollout
```

The failed operation was not resumed and invalid JSON was not reclassified as generically retryable.
The old incident also proved this response class can be intermittent: Final received HTTP 200 JSON-declared
HTML/XML, while the later guarded Provider diagnostic returned valid Store identity.

## Correction

- Repin the existing recovery-only operator to `woo-final-full-5b56469100a9`.
- Require exact `WOOCOMMERCE_INVALID_JSON`, failed Sync, stale active Work, zero completion/phase,
  zero active lock, exactly one Queue attempt and zero Coverage.
- Count all 17 WooCommerce D1 write tables by the exact incident `sync_run_id` /
  `last_sync_run_id`, including D1-only Store state, Order status observations and Order line facts.
- Require those incident-attributed rows to be zero; retained Store/Product/Category and other
  pre-existing Business facts are allowed and must not be deleted or changed.
- Run the existing Worker Preview Provider diagnostics before authorizing lifecycle recovery.
- Permit only the existing guarded `sync_work_runs` lifecycle mutation.
- Verify the exact terminal post-state and unchanged incident-attributed row counts.
- Delegate to the existing canonical WooCommerce 2026 completion launcher, which creates a new
  operation rather than resuming the terminal invalid-JSON operation.
- In the ingestion Worker only, retry at most twice after `250ms` and `1000ms` when the exact
  confirmed contamination shape occurs: direct HTTP 200, declared JSON Content-Type, no followed
  redirect and HTML/XML body. The diagnostic path keeps its existing one-request default.
- Persistent HTML/XML or every other invalid-JSON shape is returned to the existing parser and
  remains permanent `WOOCOMMERCE_INVALID_JSON`; no contaminated response is accepted as success.

## Resumability

- Active exact incident: diagnostics → recovery → completion.
- Already terminal exact incident: diagnostics → verify terminal state → completion.
- Any different operation, error code, Queue attempt count, Coverage, incident-attributed Business
  facts, lock or lifecycle state fails closed.

## Safety

```text
Invalid JSON final classification           unchanged / permanent
Contaminated response accepted as success   never
Terminal operation resume                   forbidden
Retained Business facts                     preserved
Incident Business/Coverage/Lark mutation    0
Queue message by recovery                   0
Production deployment                       0
Schedule                                    disabled
Meta                                         blocked until Woo completion PASS
```

## Required validation

```text
Focused recovery-chain and Worker fetch tests
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
Branch Verification CI
```

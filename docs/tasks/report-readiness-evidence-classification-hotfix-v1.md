# Report Readiness Evidence Classification Hotfix v1

## Status

`REPOSITORY_HOTFIX / REMOTE_EXECUTION_NOT_AUTHORIZED / PRODUCTION_BLOCKED`

## Incident evidence

A clean-main read-only audit on `612e88ee4370b02350182452ef10a81eca01b5fd` produced four distinct outcomes:

1. YouTube Source, Runtime and Lark gates passed, but every absent 1/3/7/30 materialization was incorrectly blocked as `materialization_payload_invalid`.
2. Instagram Organic and Google Ads returned assessable Remote blockers; no parser or collector crash occurred.
3. WooCommerce returned invalid Finalizer/config authority and then skipped downstream reads, producing cascade blockers without the exact observed canonical-setting/config error evidence.
4. Chatwoot's internal collector exited before assessable evidence, while the reviewed terminal retained only process status and `stderrPresent` instead of the structured child stage/code/message/details.

## Root causes

### YouTube

The collector correctly represents a missing materialization with zero D1/Lark rows and `payloadValid=false`. The assessor evaluated `payloadValid=false` before recognizing the all-zero missing state. A non-existent payload cannot be invalid; the correct first action is `create_materialization`.

### Chatwoot

The internal collector already emits sanitized structured JSON on stderr, but the reviewed terminal discarded it and returned a generic wrapper failure. This prevented safe diagnosis of local config, accepted-summary, Worker, D1 or Lark read failures.

### WooCommerce

The assessor exposed only boolean aggregate config state and the generic Finalizer error code. It did not expose the observed canonical active setting count, expected count, evidence-head equality or the original config builder error code.

## Contract

1. An exact all-zero YouTube window is classified as `create_materialization`, regardless of `payloadValid=false`.
2. Payload validity is required only when exactly one D1 materialization exists.
3. Orphan D1 or Lark rows remain blocked.
4. Chatwoot reviewed terminal parses only structured child JSON and never persists raw stderr.
5. Child stage/code/message/details pass through the existing sanitizer.
6. WooCommerce Finalizer blockers expose observed versus expected canonical setting counts and evidence-head equality.
7. WooCommerce config blockers expose the original config builder error code.
8. No Remote mutation, Provider call, Queue/DLQ action, Worker deployment, Catalog promotion, Live materialization, Schedule/Webhook change or Production action is authorized.
9. `docs/current-task.md` remains owned by the active Chatwoot recovery workstream and is unchanged.
10. PR #421 files remain unchanged.

## Required verification

```bash
npm ci
npm run check
node --test tests/scripts/youtube-report-live-readiness-audit.test.js
node --test tests/scripts/chatwoot-report-remote-readiness-collector.test.js
node --test tests/scripts/chatwoot-report-remote-readiness-reviewed-terminal.test.js
node --test tests/scripts/woocommerce-report-live-readiness-audit.test.js
node --test tests/scripts/woocommerce-report-live-readiness-audit-source.test.js
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

Repository verification performs zero Live or Remote action.

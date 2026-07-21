# Current Task — Meta DEV Schema Foundation v0.12.1

## Status

- **Task status:** `independent_review_passed_ready_for_merge`
- **Accepted baseline:** `ae13440f52f9647c18bf26a75c4e4e6f4c1f18e9`
- **Merged review:** `PR #7`
- **Working branch:** `work/meta-dev-schema-foundation`
- **Pull request:** `PR #8`
- **Environment:** developer-owned DEV
- **Profile:** `dev_ft_pumkin`
- **Approved Meta Blueprint:** `v0.12.0-meta-data-model-approved`
- **Live Lark schema apply:** `not_run`
- **Connector implementation:** `blocked_until_schema_apply_verified`
- **Last updated:** `2026-07-21`

The developer-owned Base remains DEV. No Base conversion, customer-data replacement or customer UAT action is authorized yet. Development continues until Organic and Ads connectors are complete; WooCommerce and Chatwoot live gates wait for customer-owned systems.

## Locked product scope

Organic: TikTok, YouTube, Facebook and Instagram.

Paid Ads: Meta Ads, TikTok Ads and Google Ads.

Customer-only live sources: WooCommerce and Chatwoot — `ACCESS_PENDING_CUSTOMER`.

## Current atomic objective

Create a guarded, source-controlled Meta schema installer for the existing DEV Lark Base before Meta connector coding begins.

### In scope

- derive the installable contract from the approved CSV files under `docs/meta-blueprint-v0.12.0/`;
- cover exactly 14 Raw tables plus new `MKT_Account_Daily`;
- add all non-secret Lark Table environment mappings;
- provide `setup:meta-schema` Preview and `setup:meta-schema:apply` Apply commands;
- require both `--apply` and `CONFIRM_WRITE=YES` for writes;
- fail closed unless `MKT_ENV=development` and `MKT_CUSTOMER_PROFILE=dev_ft_pumkin`;
- use the existing non-destructive/idempotent schema planner and post-apply verification;
- preserve approved field order, field type, Primary key, Select options, date format, descriptions and reference metadata;
- update safe environment examples without real IDs or secrets;
- add focused tests and run full repository regression gates.

### Out of scope

- live Lark mutation during code review;
- Facebook, Instagram or Marketing API calls;
- Meta connector implementation or activation;
- source or destination business-data writes;
- advertisement creation, activation or spend;
- TikTok Ads or Google Ads Blueprint/implementation in this atomic batch;
- WooCommerce or Chatwoot live access;
- Cloudflare deployment, remote D1 migration, Queue messages or schedule changes;
- customer UAT or Production mutation.

## Acceptance criteria

1. Schema is derived from the approved CSV contract rather than a second hand-maintained field list.
2. Exactly 15 tables and 229 fields are in scope.
3. Every table has exactly one Primary Text field as its first field.
4. Lark field types, Select options and date format match the approved contract.
5. Environment mappings exist for every new table and examples contain placeholders only.
6. Preview performs no write and produces a conflict-free create plan against an empty Base.
7. Apply remains impossible without explicit confirmation and exact DEV environment/profile pairing.
8. Existing schema installer behavior, TikTok, YouTube, Ads canonical contracts and Core regressions remain unchanged.
9. Temporary source-export workflow is removed before Review.
10. No live external-system mutation is performed by this implementation task.

## Required gates

```bash
npm ci
npm run check
node --test tests/shared/csv.test.js tests/config/meta-lark-schema.test.js
npm run test:unit
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

## Implementation result

- **Implementation status:** `PASS_FOR_MERGE`
- **Schema contract:** 15 tables / 229 fields derived directly from approved CSV files
- **Focused Meta schema/parser tests:** 10 passed, 0 failed locally and included in the remote Node suite
- **Final Branch Verification:** run `29814322283` passed on head `2ceaeb3a60b3bb9f94b4eb2d15086123cd4055c1`
- **Focused staged TikTok regression:** 4 passed, 0 failed
- **Node Unit/Integration:** 508 passed, 0 failed
- **Workers runtime:** 9 passed, 0 failed
- **Report reliability:** 70 passed, 0 failed
- **Architecture:** 137 source files, 316 local dependencies, 0 cycles
- **Repository hygiene:** passed
- **Dependency audit:** 0 vulnerabilities
- **Wrangler dry-run:** passed
- **Apply safety smoke:** UAT target rejected with `META_SCHEMA_DEV_TARGET_REQUIRED`; DEV Apply without confirmation rejected with `META_SCHEMA_WRITE_CONFIRMATION_REQUIRED`
- **Independent review:** passed after restoring the existing Wrangler example guidance and confirming no temporary workflow/patch file remains
- **Live DEV schema:** not applied
- **External API calls:** none
- **Customer data:** none
- **Production mutation:** none

## Next gate

After merge, run the read-only Meta schema Preview against the existing DEV Base. Apply only after the Preview has no conflict, then run Preview again to prove idempotency before starting Facebook Organic connector implementation.

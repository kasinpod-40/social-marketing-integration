# Current Task — Integration Workspace Baseline and TikTok Chemistry K Canonical Sync

## Status

- **Task status:** `ready_for_tiktok_chemistry_k_canonical_sync`
- **Documentation baseline:** approved by the user on `2026-07-23`
- **Runtime mutation in this task:** none
- **Lark schema/Formula/View mutation:** none
- **Production mutation:** none
- **Schedules:** unchanged
- **Last updated:** `2026-07-23`

## Authoritative operating model

The project has one pre-Production **Integration Workspace** used to assemble the whole system. It is not operated as separate DEV and UAT environments.

```text
MKT_ENV=development                 # technical runtime label only
MKT_CUSTOMER_PROFILE=integration_workspace
```

The existing developer-owned Lark Base, Worker, D1, Queue, DLQ and secret store are reused while the system is being assembled. Source ownership is tracked per Connector and may be mixed temporarily. Production remains separate and must use customer-owned resources.

Full contract: `docs/project-brain/integration-workspace.md`.

## Verified TikTok Organic state

- Lark Native `TikTok For Creator` is connected to Chemistry K account `@chemistry_k`.
- This is an established connection, not a new account switch performed in the current task.
- Latest inspected Base inventory records `2,021` rows in `RAW_TikTok_Creator_Videos` with `18` fields.
- Historical configuration labels such as `dev_ft_pumkin` or `ft_pumkin` do not prove that the current RAW records belong to another account.
- Do not delete, relabel or migrate TikTok records based only on those old configuration labels.

## Actual TikTok gap

Chemistry K TikTok RAW data has **not yet been verified as synchronized through the current runtime path** into:

- `MKT_Content`
- `MKT_Content_Daily`

The Base inventory contains records in those Canonical tables, but table-level counts alone do not prove that the current Chemistry K TikTok RAW dataset was normalized into them correctly.

Therefore the next implementation task is:

`TikTok Chemistry K RAW → MKT_Content / MKT_Content_Daily canonical sync and reconciliation`

## Next task — in scope

1. Read the protected Lark Native RAW contract without changing its schema.
2. Confirm the current runtime maps TikTok to `customerKey=chemistry_k`, `accountKey=chemistry_k` and source handle `chemistry_k`.
3. Audit existing `MKT_Content` and `MKT_Content_Daily` TikTok rows by platform/account/stable key.
4. Run a bounded manual plan/Preview before writing.
5. Sync Chemistry K RAW rows into Canonical Content and Daily tables using existing stable-key/idempotency contracts.
6. Reconcile expected, created, updated and skipped counts.
7. Rerun to prove zero duplicate rows.
8. Verify Sync Log, checkpoint, lock, retry, DLQ and alerts.
9. Keep business schedules disabled until manual validation passes.

## Out of scope for the next task

- changing the connected TikTok account;
- deleting or relabeling records from old profile names alone;
- changing Lark tables, fields, formulas or views;
- changing the current meaning, Grain or Retention of `MKT_Content_Daily`;
- adding Time-series D1 migrations or Notification tables;
- TikTok Ads;
- Google Ads deployment or signed-delivery Live validation;
- Production cutover;
- enabling schedules before reconciliation and idempotent rerun pass.

## Google Ads branch boundary

Google Ads signed-delivery implementation exists only in Draft PR `#17`. It is not merged to `main`, not deployed and has not run external PREVIEW/LIVE delivery. Do not treat Draft PR code or documentation as the current `main` implementation baseline.

After this documentation baseline is merged, work should resume from the TikTok Chemistry K Canonical sync task above before another connector workstream is advanced.

## Approved future architecture direction — not this task

The user approved a future direction for scalable Time-series retention and customer-configurable Lark Group notifications. Full decision record:

`docs/project-brain/time-series-retention-and-notification.md`

The direction is `APPROVED_DIRECTION / AUDIT_PENDING / IMPLEMENTATION_NOT_STARTED` and does not authorize Code, Lark Base, D1, Schedule or Production mutation.

Current sequencing rules:

1. Finish the bounded TikTok Chemistry K RAW → Canonical reconciliation task using the existing schema and schedules-off boundary.
2. Do not introduce Retention, delete historical rows, change `MKT_Content_Daily`/`MKT_Ads_Daily` semantics or create Notification tables inside the TikTok task.
3. Before a separate Time-series/Notification implementation, audit the complete Repository `main`, latest Base, every Daily-table Writer/Reader, Report Engine, Dashboard, D1 migrations and Draft PR `#17` impact.
4. Start implementation only after an exact Data Model, migration, dual-write, parity, rollback and schedule gate is approved in a new Current Task.

## Acceptance criteria for TikTok Canonical sync

- [ ] exact source identity is Chemistry K `@chemistry_k`
- [ ] no Lark Native RAW schema mutation
- [ ] current RAW count and unique video IDs captured before write
- [ ] Canonical TikTok rows use `accountKey=chemistry_k`
- [ ] stable keys are deterministic and source-scoped
- [ ] `MKT_Content` reconciliation passes
- [ ] `MKT_Content_Daily` reconciliation passes
- [ ] rerun creates zero duplicates
- [ ] retry/lock/DLQ/alert regression passes
- [ ] TikTok/YouTube/Core regression passes
- [ ] schedules remain disabled until accepted
- [ ] no deletion based only on legacy profile/config labels
- [ ] no Time-series/Notification schema or runtime mutation in this task

## Handoff

```text
INTEGRATION_WORKSPACE = SINGLE_PRE_PRODUCTION_WORKSPACE
TIKTOK_SOURCE = CHEMISTRY_K_EXISTING_CONNECTION
TIKTOK_RAW = POPULATED_2021_ROWS
TIKTOK_CANONICAL_SYNC = NOT_YET_VERIFIED
NEXT_TASK = TIKTOK_CHEMISTRY_K_CANONICAL_SYNC
TIME_SERIES_NOTIFICATION = APPROVED_DIRECTION_AUDIT_PENDING
GOOGLE_ADS_PR_17 = DRAFT_NOT_MERGED_NOT_DEPLOYED
LARK_SCHEMA = COMPLETE_DO_NOT_REOPEN
PRODUCTION = BLOCKED
```

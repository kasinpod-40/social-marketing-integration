# Current Task — Facebook Organic Live Rematerialization Rollout v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
BASE_MAIN                           = 0d8cac334405d755a108f2adea65e9cc6f4cd646
BRANCH                              = work/facebook-organic-live-rematerialization-rollout-v1
PR                                  = PENDING
INTEGRATION_WORKSPACE               = LIVE_EXECUTION_AUTHORIZED_AFTER_MERGE
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

นำ Shared Organic aggregation repair ที่ merge แล้วจาก PR #662 ไปใช้กับ Integration Workspace อย่างปลอดภัย โดย deploy exact `main` code ใหม่โดย **รักษา execution/runtime flags ปัจจุบันของ Worker แบบ exact** แล้ว rematerialize เฉพาะ Facebook Organic Report 1D/3D/7D/30D จาก authoritative D1 facts ไป Lark Report tables โดยไม่ยิง Facebook Provider ใหม่ ไม่เปิด/ปิด Schedule โดยไม่ตั้งใจ และไม่แตะ Production/Customer Base.

Live operator ต้องเป็น one-command, plan-only by default, fail-closed, resumable เฉพาะ verification หลัง recorded mutation และบันทึก private evidence ก่อน/หลังทุก remote mutation.

## Incident / release authority

- PR #662 merge แล้วเข้า `main` ที่ exact SHA `0d8cac334405d755a108f2adea65e9cc6f4cd646`.
- Repair เปลี่ยน Shared Organic aggregate ให้ complete/revisable coverage สามารถรวม observed members ได้ โดย source null และ row-level strict engagement ยังถูกเก็บไว้.
- Existing generic Report closeout operators ไม่เหมาะกับ rollout นี้ตรง ๆ เพราะ baseline restore บาง path ตั้ง execution flags เป็น all-false หรือ Notification-only baseline ซึ่งอาจปิด Source/Report/Notification schedules ที่ Integration Workspace เปิดใช้อยู่แล้ว.
- จึงต้อง reuse shared Report/D1/Lark/deployment primitives แต่เพิ่ม exact current-runtime preservation contract แทนการสร้าง Report engine ใหม่.

## In scope

- Exact-current Worker runtime flag readback from active Cloudflare version.
- Preserve every existing `MKT_*_ENABLED` remote flag value across deploy; local-only newly introduced flags may be admitted only when local default is false.
- Preserve current non-execution runtime mode values required by the existing Worker contract; do not mutate credentials, D1/Queue bindings, routes, crons, table IDs or secret bindings.
- Deploy current `main` code once with preserved baseline runtime state.
- If Report execution flags are already enabled, reuse that exact baseline; otherwise create a temporary Report-only overlay by turning on only the two existing Shared Report execution flags and restore the exact captured baseline afterwards.
- Rematerialize only Facebook Organic 1D/3D/7D/30D using existing stable Report identities and existing Queue job contract.
- No Provider request; source watermark/period end come from D1 Coverage/Facts.
- Preflight zero active Facebook Report work/locks/open Report DLQ/critical alerts and no pending migrations.
- D1 backup before first queue mutation.
- D1 ↔ Lark snapshot/metric/top-content parity verification after each window.
- Verify observed Facebook metric repair result for Likes/Comments/Shares/Engagement without fabricating unavailable members.
- Exact runtime restoration/readback plus post-run Alert/DLQ/Lock verification.
- Focused tests, Branch Verification, Project Brain, CHANGELOG and release handoff.

## Out of scope

- Facebook Provider refetch/backfill or connector schedule replay.
- Manual Lark metric editing.
- Meta Ads `MKT_Ads_Daily` / `MKT_Ads_Creatives` projection expansion.
- Any Production/customer-owned Cloudflare/Lark/D1/Queue mutation.
- PR #661 or branch `work/customer-base-consolidation-v1`.
- Schema migration, dashboard reconstruction, AI rerun or Notification resend.
- Changing the normal Daily/Weekly schedule contract.

## Contract

1. Operator is plan-only unless exact confirmation is supplied.
2. Live execute requires clean `main` and exact expected release SHA; branch execution is forbidden.
3. Capture active Cloudflare Worker version and all remote `MKT_*_ENABLED` values before deployment.
4. A remote enabled-flag missing from local config is a hard failure; a new local-only flag is allowed only when its source default is false and remains false.
5. Deploy baseline must preserve the captured remote execution-flag vector exactly.
6. Report overlay may differ from captured baseline only by enabling existing `MKT_REPORT_D1_READ_ENABLED` and `MKT_REPORT_PRESET_MATERIALIZATION_ENABLED`; no other flag may change.
7. If overlay deploy is needed, exact baseline must be restored and verified even after primary failure.
8. Existing routes, crons, Queue topology, D1 identity, Lark table bindings and non-secret runtime mappings must remain identical to reviewed local contract; credentials/secrets are never printed.
9. Facebook Report jobs use existing `report.materialization.generate` stable identities for exact 1/3/7/30 windows and current authoritative source watermark.
10. No Provider calls, source refresh, replay of connector work or synthetic history.
11. Before queue send require zero active Facebook Report work/locks, zero open Report DLQ/critical alerts, and zero pending D1 migrations.
12. Create one private remote D1 backup before first queue send.
13. Each window must complete with exactly one authoritative Report materialization identity, valid checksum, zero new Report DLQ, zero active Report lock and D1↔Lark value parity.
14. Source metric nulls remain null; no direct Lark patch and no conversion of missing value to zero.
15. After completion, exact captured runtime flags are the final Worker baseline; Schedule/Notification/Source flags must be unchanged from preflight.
16. Any recorded deploy/send attempt forbids blind rerun; recovery is verification/restore-first and must use retained attempt evidence.
17. Production stays blocked and PR #661 receives zero mutation.

## Acceptance criteria

- Repository operator reuses existing Shared Report job builder, D1/Lark state verifier, Queue/Cloudflare primitives and does not fork report calculation logic.
- Unit tests prove exact remote-flag preservation, local-only-false admission, remote-only flag rejection, Report-only overlay, exact restoration, and no schedule/notification flag loss.
- Tests prove exact Facebook 1/3/7/30 job selection and no Provider/source work.
- Tests prove attempt evidence blocks unsafe repeat.
- `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --audit-level=high`, `npm run deploy:dry-run`, `git diff --check` pass in Branch Verification.
- PR is merged only after all repository gates pass.
- Live execution, when run from merged `main`, returns exact Worker version(s), four report IDs/checksums, zero parity drift, zero new DLQ/critical alert/active lock, and exact pre/post runtime flag equality.
- No Production/customer Base mutation and no PR #661 mutation.

## Required tests

```bash
node --test tests/application/facebook-organic-live-rematerialization-rollout.test.js
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Pending implementation and Branch Verification.

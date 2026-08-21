# Current Task — Facebook Organic Live Rematerialization Rollout v1

## Status

```text
TASK_STATUS                         = REVIEW_READY
CURRENT_PROGRAM                     = FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_ROLLOUT_V1
BASE_MAIN                           = 0d8cac334405d755a108f2adea65e9cc6f4cd646
BRANCH                              = work/facebook-organic-live-rematerialization-rollout-v1
PR                                  = 663_DRAFT_OPEN
IMPLEMENTATION_HEAD                 = 1ba7928f9e2529d1291efb073fc54bea7d2448a8
PRE_CLOSURE_BRANCH_VERIFICATION     = 32446106165_SUCCESS
INTEGRATION_WORKSPACE               = LIVE_EXECUTION_AUTHORIZED_ONLY_AFTER_MERGE
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

นำ Shared Organic aggregation repair ที่ merge แล้วจาก PR #662 ไปใช้กับ Integration Workspace อย่างปลอดภัย โดย deploy current merged `main` ใหม่โดย **รักษา execution/runtime flags ปัจจุบันของ Worker แบบ exact** แล้ว rematerialize เฉพาะ Facebook Organic Report 1D/3D/7D/30D จาก authoritative D1 facts ไป Lark Report tables โดยไม่ยิง Facebook Provider ใหม่ ไม่เปิด/ปิด Schedule โดยไม่ตั้งใจ และไม่แตะ Production/Customer Base.

Live operator เป็น one-command, plan-only by default, fail-closed, recovery แบบ restore/verify-only หลัง recorded mutation และบันทึก private evidence ก่อนทุก remote mutation.

## Incident / release authority

- PR #662 merge แล้วเข้า `main` ที่ exact SHA `0d8cac334405d755a108f2adea65e9cc6f4cd646`.
- Repair เปลี่ยน Shared Organic aggregate ให้ `complete` / `revisable` coverage สามารถรวม observed members ได้ โดย source null และ row-level strict engagement ยังถูกเก็บไว้.
- Existing generic Report closeout operators ไม่เหมาะกับ rollout นี้ตรง ๆ เพราะ baseline restore บาง path ตั้ง execution flags เป็น all-false หรือ Notification-only baseline ซึ่งอาจปิด Source/Report/Notification/Schedule state ที่ Integration Workspace เปิดใช้อยู่แล้ว.
- งานนี้จึง reuse shared Report/D1/Lark/Queue/deployment primitives แต่เพิ่ม exact-current-runtime preservation contract แทนการสร้าง Report engine ใหม่.

## In scope

- Exact-current Worker runtime flag readback from active Cloudflare version.
- Preserve every existing `MKT_*_ENABLED` remote flag value across deploy; local-only newly introduced flags may be admitted only when local default is false.
- Preserve reviewed D1/Queue/Lark table binding identities and local Cron/topology contract; no credential/secret value is printed or rewritten by the operator.
- Deploy current merged `main` code once with preserved baseline runtime state.
- If Report execution flags are already enabled, reuse that exact baseline; otherwise create a temporary Report-only overlay by turning on only the two existing Shared Report execution flags and restore the exact captured baseline afterwards.
- Rematerialize only Facebook Organic 1D/3D/7D/30D using existing stable Report identities and existing Queue job contract.
- No Provider request; source watermark/period end come from D1 Coverage/Facts.
- Preflight zero active Facebook Report work/locks/open Report DLQ/critical alerts and no pending migrations.
- One private D1 backup before first Queue mutation.
- D1 ↔ Lark stable metric parity plus required Snapshot/Top Content materialization-shape verification after each window.
- Verify observed Facebook aggregate repair result for Likes/Comments/Shares/Engagement without fabricating unavailable members.
- Exact runtime restoration/readback plus post-run Report DLQ/Alert/Lock verification.
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
2. Live execute/recovery requires clean `main == origin/main`; merged main must contain aggregation repair SHA `0d8cac334405d755a108f2adea65e9cc6f4cd646` as an ancestor. Branch execution is forbidden.
3. Capture active Cloudflare Worker version and all remote `MKT_*_ENABLED` values before deployment.
4. A remote enabled-flag missing from local config is a hard failure; a new local-only flag is allowed only when its source default is false and remains false.
5. Deploy baseline must preserve the captured remote execution-flag vector exactly.
6. Report overlay may differ from captured baseline only by enabling existing `MKT_REPORT_D1_READ_ENABLED` and `MKT_REPORT_PRESET_MATERIALIZATION_ENABLED`; no other execution flag may change.
7. If overlay deploy is attempted, exact baseline restore is attempted in `finally` and must verify the complete captured flag vector.
8. Existing Queue topology, D1 identity and required Lark table mappings are verified against the reviewed shared runtime contract; credentials/secrets are never printed.
9. Facebook Report jobs use existing `report.materialization.generate` stable identities for exact 1/3/7/30 windows and current authoritative source watermark.
10. No Provider calls, source refresh, replay of connector work or synthetic history.
11. Before Queue send require zero active Facebook Report work/locks, zero open Report DLQ/critical alerts, and zero pending D1 migrations.
12. Create one private remote D1 backup before first Queue send.
13. Each window must retain exactly one stable D1 materialization identity, replace the previous payload checksum, complete with zero active lock/new DLQ, and converge to D1↔Lark stable metric parity.
14. Source metric nulls remain null; no direct Lark patch and no conversion of missing value to zero.
15. Rematerialized Facebook payloads must expose numeric observed aggregate totals for latest Likes, Comments, Shares and Engagement; period metrics may remain null only when source evidence remains unavailable under the Shared contract.
16. After completion, exact captured runtime flags are the final Worker baseline; Schedule/Notification/Source flags must be unchanged from preflight.
17. Any recorded deploy/send attempt forbids blind `--execute` repetition. `--recover` sends zero Queue jobs; it can restore the exact captured baseline and verify already-produced reports only.
18. Production stays blocked and PR #661 receives zero mutation.

## Implementation

Added:

- `scripts/facebook-organic-live-rematerialization-rollout.mjs`
- `scripts/lib/facebook-organic-live-rematerialization-rollout.js`
- `tests/application/facebook-organic-live-rematerialization-rollout.test.js`
- `docs/project-brain/facebook-organic-live-rematerialization-rollout-2026-08-21.md`

Reused existing shared components:

- `buildReportRuntimeCloseoutCandidates`
- reviewed Facebook Report target/preflight binding
- `createReviewedStateRuntime` and D1↔Lark stable metric integrity
- `resolveReviewedCloudflareSession` / `resolveReviewedQueue`
- `createReviewedRemoteRuntime`
- `sendReviewedQueueMessage`
- existing Lark Bitable client

No Facebook-specific Report calculation engine, new Worker, Queue, D1 table or Lark table was added.

## Verification evidence

Implementation code/test HEAD before closure docs:
`1ba7928f9e2529d1291efb073fc54bea7d2448a8`

Branch Verification:

```text
Run  = 32446106165
Job  = 96665851523
State = SUCCESS
```

Passed in that run:

- syntax architecture and hygiene
- focused Report source readiness
- focused Meta history finalizer
- focused Woo completed-state race recovery
- focused Chatwoot final UAT
- focused staged TikTok
- full Unit + Workers runtime
- Report reliability regression
- dependency audit
- Wrangler dry run
- diff whitespace check

Closure documentation archives the prior active `CHANGELOG.md` verbatim at
`docs/archive/CHANGELOG-before-facebook-observed-aggregation-live-rollout-2026-08-21.md`
and starts a concise active Changelog with both the PR #662 calculation repair and
PR #663 rollout contract. The archive preserves every prior active entry unchanged.

## Acceptance state

Repository implementation is **review ready**. A final Branch Verification on the documentation-closure HEAD is required before PR #663 leaves Draft/merges.

Live Integration execution has **not** occurred in repository CI and must not occur from the feature branch. After merge, run the exact confirmed operator only from clean current `main`; success requires four verified Facebook windows and exact pre/post runtime flag equality.

Customer-owned Production remains blocked. PR #661 and its branch remain untouched.

# Current Task — Organic Dashboard Observed-Metric Repair v1

## Status

```text
TASK_STATUS                         = MERGE_READY
CURRENT_PROGRAM                     = ORGANIC_DASHBOARD_OBSERVED_METRIC_REPAIR_V1
BASE_MAIN                           = ef5d5fc8697406102757537b5a07a4892ed096a6
BRANCH                              = work/facebook-organic-observed-metric-aggregation-v1
PR                                  = 662
INTEGRATION_WORKSPACE               = NO_MUTATION_IN_REPOSITORY_PHASE
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

แก้ Shared Organic Report aggregation ที่ทำให้ Facebook Likes / Comments / Shares / Engagement ทั้งก้อนกลายเป็น `null` เมื่อ historical content บางแถวไม่มี metric บางชนิด ทั้งที่ metric เดียวกันมี observed values ในแถวอื่นจำนวนมาก โดยต้องรักษา source `null` ไว้และห้ามแปลง missing value เป็นศูนย์.

งานนี้คืน semantics ของ Shared Organic aggregate ให้สอดคล้องกับ retained TikTok Organic calculator เดิม แต่เพิ่ม fail-closed gate ให้ observed subtotal ใช้ได้เฉพาะเมื่อ source coverage เป็น `complete`/`revisable`; period aggregate ต้องมี baseline coverage ครบทุก tracked content ด้วย. Observed zero ยังคงเป็น `0`; negative corrections ไม่ถูก clamp.

## Verified incident evidence

Latest Integration Base authority แสดง Facebook tracked content 101 แถว. `latest_views` สังเกตได้ครบ 101 แถว แต่ historical rows บางรายการมี `likes` / `comments` / `shares` เป็น `null`. Shared `calculate-organic-period-metrics.js` ใช้ strict aggregation จึงทำให้ null เพียงแถวเดียว propagate ไปเป็น aggregate `null`; Lark Dashboard แสดง card เชิงตัวเลขเป็น 0 ทั้งที่ source มี observed engagement metrics อยู่จริง.

Meta Ads Daily / Creatives ไม่ใช่ส่วนของ code fix นี้. Current Meta end-to-end contract ให้ detailed paid facts อยู่ใน D1/Shared Report และไม่ได้อนุญาตให้เติม fake Meta rows ลง `MKT_Ads_Daily` / `MKT_Ads_Creatives` เพื่อแก้หน้าจอ.

## In scope

- Shared `calculateOrganicPeriodMetrics` aggregate semantics
- coverage-gated observed subtotal สำหรับ period/current totals
- aggregate Engagement จาก aggregate Likes + Comments + Shares ภายใต้ coverage gate เดียวกัน
- focused regression สำหรับ mixed observed + missing rows
- regression ว่า all-missing ยังเป็น `null`, observed zero ยังเป็น `0`, negative correction ยังอยู่
- Project Brain / task closure documentation

## Out of scope

- Provider refetch/backfill
- Integration Lark mutationใน repository/CI phase
- Worker deploy / schedule / Queue / D1 mutation
- Production/customer Base mutation
- PR #661 หรือ branch `work/customer-base-consolidation-v1`
- Meta Ads projection expansion

## Contract

1. Source-level missing metric ต้องคง `null`; ห้าม normalize เป็น `0`.
2. Row-level combined Engagement ยังคง strict; component ใด missing ทำให้ row Engagement เป็น `null`.
3. Current-total aggregate ใช้ observed-value subtotal ได้เฉพาะ source coverage `complete` หรือ `revisable`.
4. Period aggregate ใช้ observed-value subtotal ได้เมื่อ source coverage authoritative และ baseline coverage ครบทุก tracked content.
5. ถ้า source/baseline coverage ไม่ครบ aggregate ยังคง strict/fail-closed.
6. Metric ที่ไม่มี observed member เลยต้องเป็น `null` / `not_observed`.
7. Observed zero และ negative corrections ต้องรักษาค่าจริง.
8. Baseline identities, report identities, writer contracts และ Lark schema ไม่เปลี่ยน.
9. ไม่สร้าง Report engine/helper layer ใหม่เมื่อแก้ calculator เดิมได้ตรงจุด.

## Acceptance criteria

- Mixed observed/missing Facebook-like rows ภายใต้ complete coverage ให้ numeric observed aggregate แทน whole-metric `null`.
- A metric with every member missing remains `null` / `not_observed`.
- Partial/unproven source coverage remains strict null when any contributing member is unknown.
- Existing complete-input behavior is unchanged.
- Existing TikTok semantics remain compatible.
- Focused tests pass.
- `npm run check`, `npm test`, `npm run test:report-reliability`, `npm audit --audit-level=high`, `npm run deploy:dry-run`, `git diff --check` pass in Branch Verification.
- No Integration/Production mutation occurs as part of Repository/CI implementation.

## Required tests

```bash
node --test tests/application/calculate-organic-period-metrics-observed.test.js
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

Implementation is complete and PR #662 is merge-ready pending the fresh Branch Verification triggered by these closure-document commits.

Verified runtime change:
- `calculate-organic-period-metrics.js` now uses observed subtotal only behind authoritative source/baseline coverage gates.
- Source `null` values remain `null`; no missing metric is converted to zero.
- Row-level Engagement remains strict; aggregate Engagement is derived from the aggregate component metrics under the same gate.
- Observed zero and negative corrections are preserved.

Regression coverage:
- mixed observed + missing members under complete coverage
- entirely unobserved metric remains null/not_observed
- partial source coverage remains fail-closed
- observed zero and negative correction preservation
- prior report-materialization safety expectation updated to the reviewed authoritative-coverage contract

Pre-closure verification:
- Commit: `750729654e9c6f5b8b9189f29bf7374f7dbae63c`
- Branch Verification Run: `32444055524`
- Job: `96660217831`
- Result: SUCCESS, all gates passed including Unit + Workers Runtime and Report Reliability.

Safety evidence:
- Integration Lark mutation: 0
- D1 mutation: 0
- Queue/DLQ mutation: 0
- Worker deployment: 0
- Production/customer Base mutation: 0
- PR #661 mutation: 0

The final PR head must pass Branch Verification once more before merge. The exact merge SHA will be taken from GitHub's merge result and used as the release authority in the handoff.

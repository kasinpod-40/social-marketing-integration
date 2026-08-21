# Current Task — Organic Dashboard Observed-Metric Repair v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = ORGANIC_DASHBOARD_OBSERVED_METRIC_REPAIR_V1
BASE_MAIN                           = ef5d5fc8697406102757537b5a07a4892ed096a6
BRANCH                              = work/facebook-organic-observed-metric-aggregation-v1
INTEGRATION_WORKSPACE               = READ_ONLY_UNTIL_REVIEWED_MERGE
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
CUSTOMER_BASE_PR_661                = OUT_OF_SCOPE_NO_MUTATION
```

## Objective

แก้ Shared Organic Report aggregation ที่ทำให้ Facebook Likes / Comments / Shares / Engagement ทั้งก้อนกลายเป็น `null` เมื่อ historical content บางแถวไม่มี metric บางชนิด ทั้งที่ metric เดียวกันมี observed values ในแถวอื่นจำนวนมาก โดยต้องรักษา source `null` ไว้และห้ามแปลง missing value เป็นศูนย์.

งานนี้ต้องคืน semantics ของ Shared Organic aggregate ให้สอดคล้องกับ retained TikTok Organic calculator เดิม: aggregate เฉพาะค่าที่สังเกตได้ และคืน `null` เฉพาะเมื่อ metric นั้นไม่มี observed value เลย. Observed zero ยังคงเป็น `0`; negative corrections ต้องไม่ถูก clamp.

## Verified incident evidence

Latest Integration Base authority แสดง Facebook tracked content 101 แถว. `latest_views` สังเกตได้ครบ 101 แถว แต่ historical rows บางรายการมี `likes` / `comments` / `shares` เป็น `null`. Shared `calculate-organic-period-metrics.js` ใช้ `sumStrict`, ทำให้ null เพียงแถวเดียว propagate ไปเป็น aggregate `null`; Lark Dashboard จึงแสดงค่าเชิงตัวเลขเป็น 0 ทั้งที่ source มี observed engagement metrics อยู่จริง.

Standalone TikTok Organic calculator ที่เป็น retained predecessor ใช้ `sumKnown`: กรองเฉพาะ `null` และ aggregate observed values; ถ้าไม่มี observed value เลยจึงคืน `null`.

Meta Ads Daily / Creatives ไม่ใช่ส่วนของ code fix นี้. Current Meta end-to-end contract ระบุ Lark projection เฉพาะ Ads Account / Campaign / AdSet / Ad ส่วน source facts และ paid report metrics อยู่ใน D1/Shared Report. ห้ามเติม fake Meta rows หรือเปลี่ยน architecture ใน workstream นี้.

## In scope

- Shared `calculateOrganicPeriodMetrics` aggregate semantics
- row-level period/latest engagement aggregation ที่ใช้ component metrics
- focused regression สำหรับ mixed observed + missing rows
- regression ว่า all-missing ยังเป็น `null`, observed zero ยังเป็น `0`, negative correction ยังอยู่
- documentation / Project Brain / CHANGELOG หลังผล CI ยืนยัน

## Out of scope

- Provider refetch/backfill
- Integration Lark mutation ก่อน reviewed merge
- Worker deploy / schedule / Queue / D1 mutation
- Production/customer Base mutation
- PR #661 หรือ branch `work/customer-base-consolidation-v1`
- Meta Ads projection expansion

## Contract

1. Source-level missing metric ต้องคง `null`; ห้าม normalize เป็น `0`.
2. Aggregate metric ใช้ observed-value sum: ignore `null` members; return `null` only when no member is observed.
3. Observed zero participates normally and can produce aggregate `0`.
4. Negative deltas/corrections are preserved.
5. Baseline semantics, stable report identities, writer contracts and Lark schema remain unchanged.
6. No new Report engine/helper layer when existing calculator can be repaired directly.

## Acceptance criteria

- Mixed observed/missing Facebook-like rows produce numeric observed aggregate instead of whole-metric `null`.
- A metric with every member missing remains `null` / `not_observed`.
- Existing complete-input behavior is unchanged.
- Existing TikTok semantics remain compatible.
- Focused test passes.
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

Pending implementation and Branch Verification.

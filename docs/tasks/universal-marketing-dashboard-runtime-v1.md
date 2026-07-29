# Universal Marketing Dashboard Runtime v1

## Ownership

งานนี้เป็น Workstream แยกจาก `docs/current-task.md` ซึ่งยังถือบริบท YouTube Lark Full-Sync UAT.
Base `main@d63317d989f872ff6d5698ad11184683e799d2c8`; ใช้ branch
`agent/universal-marketing-dashboard-runtime-v1` และห้ามรวม Remote operation กับ Connector/UAT
workstream อื่น

## Objective

สร้าง Dashboard contract และ renderer-neutral model เพียงครั้งเดียว ให้ทุก Social Organic และ
Paid Ads channel ที่ผ่าน Shared Report materialization ปรากฏอัตโนมัติ โดยไม่ต้องแก้ Dashboard,
Formula, Column หรือ Lark View รายช่องทาง/รายบัญชี

```text
Connector / Adapter
→ D1 Historical facts + Coverage
→ validated report_materializations
→ Universal Dashboard discovery
→ Lark Report Views / future UI / AI / Notification
```

TikTok Organic เป็นข้อมูล UAT ชุดแรกเท่านั้น ไม่ใช่ Platform contract ของ Dashboard

## In scope

- Universal Dashboard contract แบบ schema/metadata-driven
- Renderer-neutral Dashboard model จาก validated materializations เท่านั้น
- Dynamic discovery: customer, profile, platform, capability, account, period และ Report Setting
- Dynamic KPI cards จาก `metricPayload` ที่ `clientVisible=true`
- Dynamic ranking collections จาก Top Content / Top Ads
- Preserve `null` กับ observed zero
- Coverage/data-status warnings
- Lark Universal Views สำหรับ Snapshot, Metrics, Top Content และ Top Ads
- Regression ที่เพิ่ม Platform, Account และ Metric fixture ใหม่โดยไม่แก้ Dashboard source

## Out of scope

- Worker deployment
- Remote D1/Lark mutation
- Queue/DLQ message
- Schedule/Cron activation
- AI Provider หรือ Notification delivery
- Connector activation หรือ Customer LIVE UAT
- Production

## Contract

```text
source of truth           validated_report_materializations
platform discovery        materialization.platformScope
capability discovery      materialization.capability
account discovery         materialization.accountId
metric discovery          metricPayload entries with clientVisible=true
platform-specific UI      forbidden
account-specific UI       forbidden
metric-specific columns   forbidden
Detailed D1 reads         forbidden
```

Lark Dashboard Views filter only `report_type=dashboard_performance_report` และ shared
visibility/data-status fields. ไม่มี Platform หรือ Account filter ฝังใน Contract ดังนั้นข้อมูลช่องทาง
หรือบัญชีใหม่จะเข้ามาใน View เดิมทันที

## Acceptance criteria

- Current Report platforms ทั้งหมด Render ผ่าน model เดียว
- Future platform fixture Render ได้โดยไม่แก้ model
- New account ปรากฏใน dynamic filters
- New client-visible metric ปรากฏเป็น KPI card
- Hidden metric ไม่แสดง
- `0` ไม่ถูกเปลี่ยนเป็น `null`; `null` ไม่ถูกเปลี่ยนเป็น `0`
- `partial` และ coverage ต่ำกว่า 1 สร้าง warning
- Organic Top Content และ Paid Ads Top Ads แสดงผ่าน ranking collection กลาง
- Dashboard model source ไม่มี current Platform หรือ Metric literal
- Lark Dashboard Views ไม่มี Platform/Account filter
- Existing Daily/Weekly Views และ installer idempotency regression ผ่าน

## Implementation result

```text
STATUS                 IMPLEMENTED_READY_FOR_DRAFT_PR
REMOTE_ACTIONS         NONE
WORKER_DEPLOYMENT      NONE
QUEUE_MESSAGE          NONE
REMOTE_D1_MUTATION     NONE
LARK_MUTATION          NONE
SCHEDULE_MUTATION      NONE
PRODUCTION             BLOCKED
```

### Files

- `packages/config/src/universal-marketing-dashboard-contract.js`
- `packages/application/src/use-cases/build-universal-marketing-dashboard-model.js`
- `packages/config/src/dashboard-report-blueprint.js`
- `packages/config/src/lark-report-views.js`
- focused Config/Application tests

### Validation

Focused command:

```bash
node --test \
  tests/config/universal-marketing-dashboard-contract.test.js \
  tests/application/universal-marketing-dashboard-model.test.js \
  tests/config/dashboard-report-blueprint.test.js \
  tests/config/lark-report-views.test.js \
  tests/application/install-lark-report-views.test.js
```

Results:

- Focused Dashboard tests — PASS, 26/26
- `npm run check` — PASS; architecture 366 source files / 959 dependencies / 0 cycles
- Full Unit — PASS, 1,326/1,326 using current-main validation overlays only
- Workers runtime — PASS
- Report reliability — PASS, 126/126
- Wrangler dry-run — PASS; no deployment
- `npm audit` local — registry audit endpoint returned HTTP 404; exact-head GitHub CI remains authoritative

## Operational boundary

Implementation/CI must not Apply Lark Views. After review and merge, run Preview first:

```bash
npm run setup:report-views
```

Live Apply remains a separate exact-confirmation operation:

```bash
CONFIRM_WRITE=YES npm run setup:report-views:apply
```

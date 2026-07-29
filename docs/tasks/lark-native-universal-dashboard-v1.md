# Lark Native Universal Dashboard v1

## Objective

สร้าง Dashboard สำหรับลูกค้าเป็น **Lark Base Native Dashboard ภายใน Integration Workspace Base เดิม**
เท่านั้น ไม่สร้าง External Web Dashboard, Worker UI หรือ Dashboard app แยก

## Dashboard inventory

1. `📊 Executive Marketing Overview`
2. `🌱 Organic Performance`
3. `💰 Paid Ads Performance`
4. `🛒 Commerce & Conversion`
5. `💬 Customer Service & Leads`
6. `🛡️ Data Quality & Operations`

Dashboard ทั้งหกตัวอ่านจาก Shared Report materializations ผ่าน Universal Report Tables/Views ที่ติดตั้งแล้ว
ช่องทางใหม่ต้องเข้า Dashboard เดิมผ่าน Platform/Account/Capability filters โดยไม่สร้าง Dashboard ราย Platform

## Existing source views

- `🧭 Dashboard Reports`
- `🧭 Dashboard Metrics`
- `🧭 Dashboard Top Content`
- `🧭 Dashboard Top Ads`
- `💰 Top Ads`

## Public OpenAPI boundary

Official Base Server API เปิดให้:

- List dashboards — read-only identity inventory
- Copy dashboard — duplicate dashboard

Public method list ยังไม่มี API สำหรับสร้างหรือแก้ Chart, Filter control และ Layout รายชิ้น ดังนั้น:

- Repository ทำ Contract, read-only inventory, duplicate-name protection และ post-build verification
- Chart/Layout/Filter control ของ Dashboard สร้างหนึ่งครั้งใน Lark UI
- ห้ามเดา undocumented request body หรือ reverse-engineer private API
- ห้ามลบหรือแก้ Dashboard เก่าที่ไม่อยู่ใน Managed contract

## Dynamic behavior

- Dashboard ห้าม hardcode TikTok, Facebook, Instagram, YouTube, Meta Ads, Google Ads หรือ Account ID
- Platform/Account/Period filters อ่านค่าจาก Report rows
- Metric cards อ่านเฉพาะ `client_visible=true`
- Missing metric แสดง N/A; observed zero แสดง 0
- `partial`, `source_unavailable`, `not_observed` และ Coverage ต่ำกว่า 100% ต้องแสดง warning
- Commerce และ Customer Service เปิดหน้ารอได้ แต่ต้องแสดง Empty/No-data state จน Materialization พร้อม
- Data Quality & Operations เป็น Internal-only

## Repository implementation

- Native Dashboard contract: `packages/config/src/lark-native-dashboard-contract.js`
- Read-only dashboard client: `packages/connectors/src/lark/lark-dashboard.client.js`
- Identity audit: `packages/application/src/use-cases/audit-lark-native-dashboards.js`
- Local audit script: `scripts/audit-lark-native-dashboards.mjs`
- Focused tests: Config, Connector และ Application

## Read-only command

```bash
node scripts/audit-lark-native-dashboards.mjs
```

คำสั่งนี้ใช้ `GET /bitable/v1/apps/:app_token/dashboards` เท่านั้น ไม่มี Dashboard/Table/View/Record write

## Acceptance criteria

- Contract ระบุครบ 6 Native Dashboards
- External Web Dashboard ถูกห้ามโดย invariant
- Platform names ไม่ปรากฏใน Dashboard contract
- Inventory API รองรับ pagination และ block ID/name normalization
- Duplicate managed name fail closed
- Unmanaged/historical Dashboard ถูกเก็บไว้และรายงานเท่านั้น
- Missing Dashboard ออก manual action พร้อม source views/sections
- Dashboard identity ครบ 6 ตัวแล้ว Audit เป็น complete
- Chart/Layout verification ยังคง Manual Lark UI ตามขอบเขต Public API
- Repository checks, Unit/Workers, Report reliability, dependency audit และ Wrangler dry-run ผ่าน

## Safety boundary

```text
Worker deployment       none
Remote D1               none
Queue/DLQ               none
Lark record/table/view  none
Dashboard mutation      none during implementation
Schedule/Secret         none
Production              blocked
```

## Implementation incident note

ระหว่างเริ่ม Workstream เดิม มี placeholder file ถูกเขียนเข้า `main` โดยผิด branch จาก Connector call และถูกลบทันทีใน commit ถัดไปก่อนเริ่ม Implementation จริง ไม่มี Runtime, Lark หรือ Remote action เกิดขึ้น Branch ภายนอกเดิมถูก reset กลับ Current main และ Workstream นี้ใช้ branch แยก `agent/lark-native-universal-dashboard-v1`.

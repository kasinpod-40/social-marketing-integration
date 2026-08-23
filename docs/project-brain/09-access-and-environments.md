# 09 — Access and Environments

## Ownership model ที่ใช้จริง

### DEV

- Lark Base, Lark App, Cloud/runtime และบัญชี TikTok ทดสอบเป็นทรัพยากรของผู้พัฒนา
- Runtime profile: `dev_ft_pumkin`
- TikTok source: `@ft.pumkin`
- ใช้เพื่อพัฒนา, Dry run, Regression และ UAT ก่อนติดตั้งลูกค้า

### Production — Chemistry K

- ลูกค้าต้องเป็นเจ้าของ Lark Base, Lark App, Cloudflare/runtime, Secrets และ Platform assets ทั้งหมด
- ผู้พัฒนาได้รับเชิญด้วย Role/IAM ที่เหมาะสม ห้ามแชร์ Password
- Runtime profile `chemistry_k` เตรียมไว้ใน Source codeแล้ว
- Table IDs และ Secret จริงต้องตั้งใน Environment ของลูกค้า ไม่แก้ Source codeตอน Deploy

## Runtime selector

```env
# DEV
MKT_ENV=development
MKT_CUSTOMER_PROFILE=dev_ft_pumkin

# Production
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

ระบบต้องหยุดทันทีเมื่อ Environment/Profile จับคู่ไม่ถูกต้อง

## Connector feature flags

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
```

Connector ที่ยังเป็น `planned` ห้ามเปิดเป็น `true` ระบบจะ Fail ตอนโหลด Runtime config

Identity ที่ขึ้นกับบัญชีจริงเปลี่ยนผ่าน Environment ได้ เช่น:

```env
TIKTOK_SOURCE_HANDLE=ft.pumkin
```

`accountKey` สำหรับ Stable key ยังอยู่ใน Customer profile และห้ามเปลี่ยนหลังเริ่มใช้งานจริง

## Controlled Production connector UAT

Normal Production runtime ต้องใช้ Connector ที่ผ่าน `largeAccount.productionReady=true` เท่านั้น ห้ามแก้ `liveAccountUat=true` ล่วงหน้าและห้าม bypass `assertConnectorRunnable()` เพื่อให้ Production ทำงานได้

กรณี Connector อยู่สถานะ `dev_ready` ซึ่งหมายถึง Technical/Large-fixture gates ผ่านครบและขาดเพียง `liveAccountUat` ระบบมี lane ชั่วคราวสำหรับเก็บ Customer-owned Production evidence โดยต้องเปิดพร้อมกันทุกเงื่อนไข:

```env
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_PRODUCTION_CONNECTOR_UAT_ENABLED=true
MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR=tiktok
```

Queue job ต้องใช้ Trigger กลาง `production_connector_uat` ด้วย การเปิด Environment gate อย่างเดียวไม่ทำให้ Scheduled หรือ Legacy manual job ข้าม Production readiness gate ได้

กฎของ lane นี้:

- ใช้ได้ทีละ Connector ผ่าน exact selector เท่านั้น
- รับเฉพาะ Connector สถานะ `dev_ready` ที่ `missingGates=['liveAccountUat']`
- Connector สถานะ `foundation_ready` หรือ `planned` ยังถูกปฏิเสธ
- ห้ามเปิด Cron/Schedule เพื่อทำ Live UAT
- หลังเก็บหลักฐาน First run + exact rerun/idempotency แล้ว ต้องปิด `MKT_PRODUCTION_CONNECTOR_UAT_ENABLED=false` ก่อน Promote readiness
- การ Promote `liveAccountUat=true` / `verified` ต้องเป็น Reviewed change แยกที่อ้างอิง External evidence จริง

TikTok ผ่าน lane นี้เมื่อ 2026-08-23 ด้วย fresh customer Production operation 2,046 records, bounded
source/preflight/write 82/82 units, final reconciliation, checkpoint `2026-08-23`, zero exact-scope
alert/DLQ/lock และ same-identity replay ที่ไม่เปลี่ยน Business state. ดังนั้น TikTok ถูก promote เป็น
`verified` ผ่าน reviewed change แยก; UAT flags ถูกปิดก่อน promotion และกฎ lane ข้างต้นยังใช้กับ
Connector อื่นโดยไม่เปลี่ยนแปลง.

TikTok Scheduled producer ใช้ post-Lark watermark probe ไม่ใช่ direct blind sync. Router ของ probe และ
admitted sync ยอมรับเฉพาะ developer-owned Integration Workspace หรือ exact customer-owned Production
`chemistry_k`; profile/customer/ownership อื่นต้อง fail closed ก่อน Lark/Queue business mutation.

Release example ต้องคงค่า Default ดังนี้เสมอ:

```env
MKT_PRODUCTION_CONNECTOR_UAT_ENABLED=false
MKT_PRODUCTION_CONNECTOR_UAT_CONNECTOR=
```

## Source code กับ Secret

เก็บใน Source codeได้:

- Customer/profile key
- Stable account key
- Connector catalog และ Feature mapping
- Display name ของลูกค้า
- Field/table env mapping
- ค่า default ที่ไม่เป็นความลับ
- คอมเมนต์ภาษาไทย

ห้ามเก็บใน Source code/Git/ZIP/Log:

- App secret, Access token, API key
- Password, Webhook secret
- OAuth refresh token
- Database credentials

## Freelancer constraint

ผู้พัฒนาไม่มีบริษัทจดทะเบียน จึงใช้ Client-owned Production resources เป็นค่าเริ่มต้นสำหรับ Business verification, Developer app review และสิทธิ์ Platform ทางการ

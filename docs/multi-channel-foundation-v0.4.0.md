# Multi-channel Foundation — v0.4.0

## เป้าหมาย

เตรียมโครงสร้างกลางที่ทุก Connector ใช้ร่วมกันได้ โดยไม่สร้าง API integration ปลอมหรือเปิดช่องทางที่ยังไม่ผ่าน Data Model/Blueprint

## สิ่งที่เพิ่ม

### Connector Catalog

Catalog กลางอยู่ที่:

```text
packages/config/src/connector-catalog.js
```

Connector ที่ลงทะเบียนแล้ว:

- TikTok — `active`
- Facebook Page — `planned`
- Instagram Business — `planned`
- YouTube — `planned`
- WooCommerce — `planned`
- Chatwoot — `planned`

การมีชื่อใน Catalog ไม่ได้หมายความว่า Connector ใช้งานได้ทันที ต้องมีทั้ง Implementation จริงและ Feature flag ที่เปิดใช้งาน

### Runtime Connector Config

Runtime config รวม Profile + Environment feature flag ที่:

```text
packages/config/src/connector-runtime-config.js
```

กฎ:

- `accountKey` มาจาก Customer profile และเป็น Stable identity ห้ามเปลี่ยนหลังเริ่มใช้งานจริง
- Identity ที่ขึ้นกับทรัพยากรจริง เช่น TikTok handle เปลี่ยนผ่าน Environment ได้
- Feature flag รับเฉพาะ `true` หรือ `false`
- Connector สถานะ `planned` เปิดไม่ได้ แม้ตั้ง flag เป็น `true`

### Connector Registry

Registry ที่ Application layer ใช้ตรวจ Readiness อยู่ที่:

```text
packages/application/src/connectors/connector-registry.js
```

Runtime จะเรียก Connector ได้เมื่อ:

1. Connector เป็น `active`
2. Customer profile มี Config ครบ
3. Feature flag เปิด

### Queue Job Catalog และ Schema

Job type กลางอยู่ที่:

```text
packages/application/src/jobs/job-catalog.js
packages/application/src/jobs/queue-job.js
```

Queue schema ปัจจุบันคือ version `1` และยังรองรับ Job เดิมที่ไม่มี `schemaVersion` โดยกำหนดเป็น version `1` อัตโนมัติ

Job ที่ลงชื่อไว้แต่ยังไม่ Implement จะตอบ Error แบบ Permanent ด้วยรหัส `SYNC_JOB_NOT_IMPLEMENTED` และไม่แตะ Lark credential หรือคืนค่า Fake success

### Feature flags

```env
MKT_CONNECTOR_TIKTOK_ENABLED=true
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_YOUTUBE_ENABLED=false
MKT_CONNECTOR_WOOCOMMERCE_ENABLED=false
MKT_CONNECTOR_CHATWOOT_ENABLED=false
```

TikTok source handle สามารถ Override ตอน Deploy:

```env
TIKTOK_SOURCE_HANDLE=ft.pumkin
```

Production ใช้ค่า handle จริงของบัญชีลูกค้า โดยไม่แก้ Source code

## สิ่งที่ยังไม่ได้ทำใน Release นี้

- ไม่มี Facebook/Instagram/YouTube API client
- ไม่มี WooCommerce/Chatwoot API client
- ไม่มี Field mapping หรือ Canonical key ของช่องทางใหม่
- ไม่มี Scheduler ที่สั่ง Sync ช่องทางใหม่
- ไม่มี Fake adapter, Placeholder success หรือ Dummy write

Implementation จริงของแต่ละช่องทางต้องเริ่มหลัง Data Model, Lark Blueprint, Source contract, Key และ Metric definition ผ่านก่อน

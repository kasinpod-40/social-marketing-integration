# Customer-owned Production Cutover v1

## Boundary

Production ต้องสร้างใหม่ใน Account/Workspace ที่ลูกค้าเป็นเจ้าของ ห้ามนำ Integration Workspace ไปใช้
เป็น Production โดยตรง และห้ามคัดลอก Secret ลง Repository หรือ Lark.

```text
MKT_ENV=production
MKT_CUSTOMER_PROFILE=chemistry_k
```

## Customer-owned inventory ที่ต้องส่งมอบก่อนเริ่ม

- Lark Base, Lark App, table/view/dashboard/automation ownership และ administrator อย่างน้อย 2 คน;
- Cloudflare Account, API Worker, Sync Worker, D1, Queue, DLQ, Cron และ observability;
- Google Cloud OAuth project สำหรับ YouTube และ Google Ads customer connection;
- Meta App และ User/Page credentials ที่มี permission ครบ;
- WooCommerce REST credential และ Chatwoot access token;
- Google Ads Manager Script, signed endpoint key ID และ HMAC secret;
- Platform asset IDs/mappings ที่ลูกค้ายืนยันแล้ว.

เก็บเฉพาะ non-secret IDs/mappings ใน config. Token, secret, password, private key และ OAuth refresh
credential ต้อง provision ผ่าน Secret store ของลูกค้าเท่านั้น.

## Provisioning order

1. Deploy API/Sync Worker โดย execution/source/report/notification flags เป็น `false` ทั้งหมด.
2. Apply D1 migrations ตามลำดับและ export backup ก่อน/หลัง migration.
3. Clone Lark schema, Views, Dashboard และ Automations; ยืนยันว่า Base Notification Automation ปิด.
4. ใส่ Variables และ Secrets ใน Account ลูกค้า แล้วทำ GET-only identity/permission preflight.
5. เปิด Connector ทีละตัว: TikTok Organic → Facebook/Instagram → Meta Ads → Google Ads → YouTube →
   WooCommerce → Chatwoot. TikTok Ads ไม่อยู่ใน scope.
6. แต่ละ Connector ใช้ fresh operation identity, controlled backfill, D1↔Lark parity, zero new alert/DLQ
   และ idempotent rerun ก่อนเปิดตัวถัดไป.
7. Materialize Dashboard `1D/3D/7D/30D`; ตรวจ null/zero/partial/revisable และ customer mappings.
8. เปิด Source schedules ก่อน Daily/Weekly Report schedules.
9. เปิด Automatic Weekly หลัง scheduled evidence exactly once และพิสูจน์ว่าไม่มี duplicate producer.
10. Customer UAT, sign-off, rollback snapshot และ 72-hour monitoring ก่อนประกาศ Full LIVE Pass.

## Rollback

- ปิด schedule/connector flag ของตัวที่ผิดก่อน ไม่ปิดระบบอื่นแบบเหมารวม;
- ใช้ `MKT_REPORT_D1_READ_ENABLED=false` กลับ reader เดิมได้เฉพาะก่อน Lark retention deletion;
- restore D1 จาก customer-owned export และ Lark จาก exact stable-key backup;
- ห้าม replay completed Work, bulk redrive DLQ หรือ fabricate missing metrics;
- เก็บ incident evidence และเปิด fresh operation หลัง root cause/reviewed deploy เท่านั้น.

## Current external waits

- ลูกค้าต้องให้ Facebook token ที่มี `pages_read_user_content` แล้วจึงทำ fresh Likes/Comments parity;
- ลูกค้าต้องสร้าง/มอบ customer-owned Production inventory ด้านบน;
- Integration scheduled soak และ Automatic Weekly evidence เป็นหลักฐานเวลา ไม่ใช้ manual run แทน.

Runbook นี้เตรียมขั้นตอนและ ownership contract เท่านั้น ไม่ provision Production resource และไม่เปิด flag.

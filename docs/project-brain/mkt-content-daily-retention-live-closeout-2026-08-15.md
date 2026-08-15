# MKT_Content_Daily Retention Live Closeout — 2026-08-15

## Incident

`MKT_Content_Daily` เป็น Lark compatibility cache แต่ยังเติบโตตาม Content × Date จนชนเพดาน 20,000
Records. YouTube scheduled generation เขียนได้ 100 แถวก่อน Lark ตอบ `RecordExceedLimit`; D1 source,
inventory และ Analytics staging ครบ แต่ Lark phase จบ partial. Operation/alert เดิมเก็บเป็น forensic
evidence และห้าม replay; จะปิดเป็น resolved-by-new-generation หลัง scheduled YouTube generation ใหม่สำเร็จ.

## One-time exact cleanup

ผู้ใช้อนุมัติให้ปิดงานอื่นโดยไม่รอ Facebook. Retention contract จึง defer platform `facebook` ทั้งหมด:

```text
records before             = 19,940
exact deletes              = 10,649
  tiktok                   = 8,138
  youtube                  = 2,511
records after              = 9,291
facebook retained          = 425 / 425
instagram retained         = 37 / 37
effective window           = 4 completed days + latest every Content
D1 mutations               = 0
Queue messages             = 0
Worker deployments         = 0 during cleanup
```

ก่อนลบมี private full-record backup, exact candidate list, D1 authority snapshot และ SHA-256 ทุกชุด.
Operator ปฏิเสธ active non-Ads work/lock, duplicate stable key, deferred-platform delete และ plan ที่ไม่
partition ตารางครบ. หลังลบอ่านทั้งตารางกลับและยืนยัน deleted IDs หาย, retained IDs อยู่ครบ, row count ตรง,
TikTok Native RAW Table ID และ source fingerprint ไม่เปลี่ยน. Evidence อยู่ใต้ private directory
`/private/tmp/social-mkt-content-daily-retention-deferred-facebook-20260815-live` และไม่ commit customer data.

## Permanent runtime correction

PR #646 เพิ่ม reviewed one-time operator. PR #647 ย้าย planner เข้า Application contract และเพิ่ม:

- Job type `lark.mkt-content-daily.retention` พร้อม stable daily Queue identity;
- schedule 08:05 Asia/Bangkok ก่อน Daily Report 08:10;
- exact-ID batch delete เท่านั้น ไม่มี prefix/filter delete;
- active D1 sync-lock check ก่อนเริ่มและก่อนทุก chunk;
- full retained-identity readback หลัง execution;
- `MKT_CONTENT_DAILY_RETENTION_DEFERRED_PLATFORMS=facebook` จน Facebook credential/parity ผ่าน.

Reviewed Worker version `3d9c363d-d1fc-4cfe-b275-9fa75b0a6ca1` รับ traffic 100%. Immediate post-deploy
open alert, DLQ, active lock และ manual retention operation ใหม่เป็นศูนย์. Scheduled evidence รอบแรกต้อง
มาจาก cron จริง; manual run ห้ามใช้แทน.

## Remaining boundaries

- Facebook connector/schedule ยังปิดและ retention defer ทุก Facebook row; เมื่อลูกค้าให้ Token ที่มี
  `pages_read_user_content` ต้อง fresh run/reconciliation ก่อนเอา Facebook ออกจาก defer list.
- YouTube capacity alert เดิมยังไม่เปลี่ยนสถานะจน scheduled generation ใหม่สำเร็จหลังมีพื้นที่.
- Non-TikTok RAW retirement ยังรอ fresh scheduled connector cycles หลัง Worker version นี้.
- Automatic Weekly ยังรอหลักฐาน cron วันจันทร์ 08:30 และ Production ยังรอ customer-owned assets.

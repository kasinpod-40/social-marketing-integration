# TikTok MKT_Accounts Master — 2026-08-16

## Objective

ให้ `MKT_Accounts` เป็น Account master ของ Organic channels ครบ Facebook, Instagram, TikTok และ
YouTube พร้อมรักษา stable identity, idempotency และ partial-write semantics ของ TikTok Native sync.

## Root cause

TikTok Native source ถูกอ่านจาก protected `RAW_TikTok_Creator_Videos` และเขียนปลายทางเฉพาะ
`MKT_Content` กับ `MKT_Content_Daily`. Active router, validation และ staged/legacy use cases ไม่เคยรับ
mapping `mktAccounts` จึงไม่มี producer สำหรับ TikTok Account row. การลบ non-TikTok RAW mirrors ไม่ได้
ลบหรือทำให้ Account row หาย เพราะ row นี้ไม่เคยถูกสร้างมาก่อน.

## Account contract

```text
account_key        = tiktok:${accountId}
platform           = tiktok
account_id         = configured TikTok customer account ID
account_name       = @${sourceHandle}
account_type       = profile
connection_status  = connected
timezone           = reporting timezone (default Asia/Bangkok)
last_sync_at       = deterministic metric-date instant
```

- Source-handle identity guard ต้องผ่านก่อน Account plan.
- Account plan ใช้ existing stable-key sync engine จึง create/update/skip แบบ idempotent.
- Legacy path เขียน Account หลัง Content และ Daily สำเร็จ.
- Staged/D1-first path preflight Account ครั้งเดียว แล้วเขียนครั้งเดียวหลังทุก source unit สำเร็จ.
- หาก Content/Daily ล้ม ระบบไม่เขียน Account เป็น `connected`.
- Partial-result และ durable retry state นับ Account writes แยกจาก Content/Daily.

## Live exact backfill evidence

ก่อน mutation ได้สำรอง `MKT_Accounts` 3 rows แบบ private ที่
`/private/tmp/social-mkt-tiktok-account-backfill-20260816/mkt-accounts-before.json` ด้วย file mode 0600;
SHA-256 คือ `42d849eb99e7010fb8fc6c206eccb4413559efb5036e1a22529e4936fb4989ab`.

Exact create เพิ่มเฉพาะ `tiktok:chemistry_k`. GET-only readback หลังเขียนยืนยัน:

```text
before rows               = 3
after rows                = 4
created TikTok rows       = 1
prior identities unchanged = 3/3
```

ไม่มีการแก้ Facebook, Instagram, YouTube, protected TikTok RAW, schedule, Queue, secret, Worker หรือ
Production. Backup เป็น local private evidence และห้าม commit.

## Verification

```text
Focused TikTok tests             25/25 pass
D1-first ordering tests           2/2 pass
Full unit tests                3047/3047 pass
Workers runtime tests            18/18 pass
Report reliability              105/105 pass
Architecture/hygiene                  pass
npm audit                   0 vulnerabilities
API/Sync deploy dry-run               pass
```

Combined `npm test` ใน restricted sandbox จบ unit 3047/3047 แต่ Workers runtime เปิด loopback ไม่ได้;
เมื่อ rerun Workers runtime ใน approved execution context ผ่าน 18/18. ไม่มี deployment เกิดจาก dry-run.

## Release state

Live Account master ใช้งานได้ทันที 4 ช่องทาง. Permanent TikTok scheduled maintenance ถูก implement และ
verify แล้วใน branch แยก แต่ยังไม่ commit/push/merge/deploy. ก่อน release ต้องผ่าน review ตามปกติ;
Production gate และ Automatic Weekly time gate ไม่เปลี่ยนจาก Current Task.

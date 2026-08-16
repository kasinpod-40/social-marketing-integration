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
Full unit tests                3048/3048 pass
Workers runtime tests            18/18 pass
Report reliability              105/105 pass
Architecture/hygiene                  pass
npm audit                   0 vulnerabilities
API/Sync deploy dry-run               pass
```

Combined `npm test` ใน restricted sandbox จบ unit 3048/3048 แต่ Workers runtime เปิด loopback ไม่ได้;
เมื่อ rerun Workers runtime ใน approved execution context ผ่าน 18/18. ไม่มี deployment เกิดจาก dry-run.

## Release state

Live Account master ใช้งานได้ทันที 4 ช่องทาง. PR #653 ผ่าน CI และ merge หลัง Facebook PR #652; exact main
`dff7c1e6cfe78740945f2a7e991ba8cc3a5acab5` deploy เป็น Worker version
`377bb562-46f0-44af-8aea-13b3e928bcaf` ที่ traffic 100%. Immediate post-deploy D1 readback พบ alert ใหม่ 0,
DLQ ใหม่ 0 และ lock 0; GET-only Lark readback ยังผ่าน 4/4. Meta Ads A22 ที่ยัง active เป็น retained forensic
identity เดิม ไม่ใช่ regression. ไม่มี manual Queue/source run; fresh scheduled evidence และ Automatic Weekly
ยังต้องรอตามเวลาจริง. Production gate ไม่เปลี่ยนจาก Current Task.

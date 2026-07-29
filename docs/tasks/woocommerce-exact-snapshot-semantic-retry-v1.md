# WooCommerce Exact Snapshot Semantic Retry v1

## Incident

หลัง exact lifecycle reactivation ผ่านแล้ว Final operator remote preflight เห็น pinned active work
ครบ แต่ D1 snapshot query ถัดมาได้รับ successful envelope ที่ scalar subqueries เป็น `null`
และทุก Commerce count เป็น `0` ชั่วคราว. Read-only inspector ทันทีหลัง failure เห็น operation
และ partial facts เดิมครบ จึงเป็น semantic-empty remote read ไม่ใช่ durable state drift.

Attempt นี้หยุดใน `exact-continuation-preflight` ก่อน Lark schema, D1 backup, Worker deploy
และ Queue send.

## Correction

- Exact continuation อ่าน snapshot แบบ bounded สูงสุด 5 ครั้ง ใช้ delay `1s, 2s, 5s, 10s`.
- Retry เฉพาะ snapshot ที่ว่างครบทุกมิติ: Sync/Work/Queue/Fence identity ไม่มี, state/completion
  ไม่มี, Coverage/attempt/counts ทั้งหมดเป็นศูนย์.
- Snapshot ที่มีข้อมูลบางส่วนแต่ผิด exact contract fail closed ทันที.
- Command-level D1 failures ยังคงใช้ read-only Wrangler retry เดิม.
- Semantic retry อยู่ก่อน Lark schema, backup, deploy และ Queue ทุกชนิด.

## Verification

```text
Focused rollout tests             13/13 PASS
Unit tests                        1490/1490 PASS
Workers runtime                   16/16 PASS
Report reliability               101/101 PASS
Architecture/hygiene              404 modules / 0 cycles
npm audit                         0 vulnerabilities
Deploy dry-run                    PASS
Remote mutation during hotfix     NONE
```

## Safety

Production และ Schedule/Cron ไม่เปลี่ยน. Hotfix ไม่มี Remote mutation และไม่เปลี่ยน exact
operation identity. หลัง exact-head CI/Squash Merge ให้ retry operation
`woo-final-full-e2372e56d52d` เดิมเท่านั้น.

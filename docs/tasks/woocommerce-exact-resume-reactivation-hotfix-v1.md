# WooCommerce Exact-resume Reactivation Hotfix v1

## Objective

คืน durable lifecycle ของ operation เดิม
`woo-final-full-e2372e56d52d` จาก accidental generic recovery ให้กลับเป็น `active`
โดยไม่เปลี่ยน Phase, Work unit, Generation fence, Queue identity, Coverage,
Commerce Business facts หรือ Lark records แล้วจึงให้ Final operator resume operation เดิมเท่านั้น.

## Incident

operation นี้ถูก admit เพียงครั้งเดียวและหยุดที่ Orders page 2 หลังเขียน partial D1/Lark facts.
หลัง D1 100-bound-parameter fix merge แล้ว exact continuation launcher รุ่นเดิมเรียก generic
failed-work recovery ก่อนอ่าน `MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID` จึงเปลี่ยน
`sync_work_runs.lifecycle_status` เป็น `terminal` แม้มี Coverage และ Business rows.
จากนั้น Final operator หยุดก่อน Deploy/Queue เพราะ runtime script ขาด `optionalText`.

Live read-only inspection บน `main@b10458e3873a16481264fa4889a88620b9669c3d`
ยืนยัน operation เดิมยังมี:

```text
Sync Run                   failed / WOOCOMMERCE_D1_READ_FAILED
Work lifecycle             terminal
Phase                      incomplete / datasetIndex 1 / page 2
Active lock                0
Queue attempts             7
Coverage                   2 / invalid 1
Commerce Business rows     897
Queue/Deploy/Lark mutation 0 during the failed continuation attempt
```

## Correction contract

- Source-safe launcher ข้าม generic recovery เมื่อ exact continuation ถูก pin.
- Generic failed-work recovery เลือกและ update ได้เฉพาะ failed work ที่ Coverage `0` และ
  Commerce Business rows `0`; guard เดิมถูกตรวจซ้ำใน mutation statement เพื่อปิด race.
- One-command และ Final remote preflight ยอม active work ได้เฉพาะ exact pinned work หนึ่งรายการ,
  zero other active work และ zero live locks. Migration 0017 ต้องไม่ pending.
- Final operator มี `optionalText` helper ที่ขาดหาย.
- Reactivation operator pin exact operation, account, accidental terminal reason และ audit SHA.
- Reactivation preflight ต้องตรงกับ failed code, phase/page, Queue/Work/Fence generation,
  Coverage และ exact 14-table row counts ที่ตรวจจาก Live state.
- Mutation เป็น guarded `UPDATE sync_work_runs` แถวเดียว: เปลี่ยน lifecycle เป็น `active`
  และล้างเฉพาะ terminal metadata ที่ generic recovery เติม.
- Read-only post-verification ต้องยืนยัน immutable fingerprint เดิม, active work exact one,
  zero other work/locks และไม่มี Business/Coverage/Queue/Lark mutation.

## Commands

Plan-only:

```bash
node scripts/woocommerce-final-exact-resume-reactivate.mjs \
  --operation-id woo-final-full-e2372e56d52d
```

Execute หลัง exact-head CI และ Squash Merge เท่านั้น:

```bash
CONFIRM_WOOCOMMERCE_EXACT_RESUME_REACTIVATION=REACTIVATE_WOO_FINAL_FULL_E2372E56D52D_ONLY \
node scripts/woocommerce-final-exact-resume-reactivate.mjs \
  --operation-id woo-final-full-e2372e56d52d \
  --execute
```

จากนั้น resume ด้วย `MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID` เดิม ห้ามสร้าง full operation ใหม่.

## Verification

```text
Focused exact-resume/recovery/one-command/rollout tests   33/33 PASS
npm ci                                                   PASS
npm run check                                            PASS / 404 modules / 0 cycles
npm test:unit                                            1488/1488 PASS
npm run test:worker                                      16/16 PASS
npm run test:report-reliability                          101/101 PASS
npm audit                                                0 vulnerabilities
npm run deploy:dry-run                                   PASS
Live read-only incident inspection                       PASS
Remote mutation during implementation                    NONE
```

## Safety

- Integration Workspace `development` / `integration_workspace` / `chemistry_k` เท่านั้น.
- Production, Schedule/Cron และ AI Summary ไม่เปลี่ยน.
- Reactivation ไม่ Deploy Worker, ไม่ส่ง Queue/DLQ, ไม่เรียก Provider/Lark และไม่เปลี่ยน
  Business/Coverage facts.
- Safe Worker คง all execution flags false จนกว่า merged operator ผ่าน reactivation preflight.

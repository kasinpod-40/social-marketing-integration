# Lark Dashboard Shared Dimensions Backfill Post-Apply Verification Hotfix

## Status

```text
Task                              Repository implementation validated
Incident main                     6c249e794ce51d118c841ff17d12fd823647fd46
Implementation base main          ab56882
Branch                            hotfix/lark-dashboard-backfill-post-verify-v1
Operator                          scripts/lark-dashboard-shared-dimensions-backfill.mjs
Operator version                  lark-dashboard-shared-dimensions-backfill-v1.2
Remote action count               0
```

`ab56882` เป็น Current `origin/main` ตอนเริ่ม Implementation และมี Incident SHA `6c249e7`
เป็น ancestor. Branch นี้จึงเริ่มจาก Main ล่าสุดโดยไม่ทิ้ง correction หลัง Incident.

## Incident

Preview ก่อน Apply:

```text
materializations = 2
createRows       = 0
updateRows       = 32
safeToApply      = true
```

Apply ก่อนหน้าถูกสั่งด้วย exact confirmation และจบด้วย:

```text
code       = LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED
createRows = 0
updateRows = 32
```

Failure เกิดหลัง `preview.planner.executeAll()` ใน Post-apply verification จึงห้ามสรุปว่า
Lark write ล้มเหลวจาก Error นี้เพียงอย่างเดียว.

## Root cause decision

Repository path เดิมคือ:

```text
preview.planner.executeAll()
→ planBackfill()
→ assertBackfillVerificationComplete()
```

ยืนยัน defect ว่า verification ทำ fresh plan เพียงครั้งเดียวทันทีหลัง write. Contract นี้
แยกไม่ได้ว่า pending 32 rows มาจาก Lark read-after-write eventual consistency หรือ mismatch
ที่คงอยู่จริง.

Source review ยืนยันว่า record search path เรียก Lark search ใหม่ทุก plan และไม่ได้ reuse
stale record response; runtime cache เฉพาะ table field schema. Existing serializer normalize
Text rich shape, SingleSelect option shape และ Number string/formatter ก่อน compare รวมถึง
รักษา observed zero ให้ต่างจาก omitted/null. อย่างไรก็ตาม Remote cause ที่แท้จริงยังไม่ยืนยัน
เพราะ Safety boundary ห้าม Live Apply/Remote mutation ระหว่าง Implementation.

Decision:

- attempt ถัดไปเห็น zero pending = evidence ของ delayed read convergence;
- ทุก fresh attempt ยังเห็น pending = Fail closed และรายงาน sanitized comparison diagnostics;
- ห้ามใช้ Batch update response อย่างเดียวตัดสิน successful convergence.

## Retry contract

Post-apply verification ใช้ bounded read-only retry:

```text
delays                    [0, 1000, 2000, 4000, 8000] ms
maximum attempts          5
maximum elapsed budget    30000 ms
plan instance             new on every attempt
Lark record read          fresh on every attempt
write retries             0
success                   createRows=0, updateRows=0
```

`executeAll()` ของ initial reviewed plan ทำครั้งเดียวก่อนเริ่ม verifier. Retry callback สร้าง
`planBackfill()` ใหม่และเรียกเฉพาะ `planner.summarize()`; ไม่มี `executeAll()` ภายใน retries.
หาก elapsed budget หมดก่อนครบ delay list จะหยุดทันที.

`createRows>0` ยังคง Block ทันทีด้วย `LARK_DASHBOARD_BACKFILL_CREATE_BLOCKED`.
Persistent `updateRows>0` หลัง bounded attempts ใช้
`LARK_DASHBOARD_BACKFILL_POST_VERIFY_FAILED`.

## Sanitized persistent diagnostics

Error/output อนุญาตเฉพาะ:

```text
attempts
elapsedMs
final.createRows
final.updateRows
final.skippedRows
pendingRowsByLogicalTable[].logicalTableKey
pendingRowsByLogicalTable[].createRows
pendingRowsByLogicalTable[].updateRows
pendingFieldNameCounts
readStrategy
```

Diagnostics ไม่รวม Business values, Caption, Metric values, Token/Secret, Lark record payload,
record ID หรือ physical Lark Table ID. Pending field-name counts มาจาก exact normalized
comparison ของ `TableSyncEngine`, ไม่ใช่จาก payload logging.

## Recovery preview

หลัง Merge ให้รันจาก clean Current `main`:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

คำสั่งนี้อ่าน Remote D1/Lark เพื่อวางแผนเท่านั้นและไม่เขียน:

- `summary.updateRows=0` และ
  `recoveryDecision=previous_apply_converged_no_apply_needed`:
  Apply ก่อนหน้า converge แล้ว ห้าม Apply ซ้ำ.
- `summary.updateRows>0` และ
  `recoveryDecision=pending_updates_require_separate_apply_approval`:
  ยังมี pending จริง ต้องขออนุมัติ Apply ใหม่แยกต่างหาก.

Preview ไม่ infer success จาก Batch update response และไม่ส่ง Queue, Deploy Worker,
แก้ Schedule หรือเขียน D1.

## Stable contracts preserved

- Stable keys ทุกตารางไม่เปลี่ยน.
- Allowed-field restriction เดิมคงอยู่.
- Exact Apply confirmation gate เดิมคงอยู่.
- `createRows>0` Block เหมือนเดิม.
- Missing/null ไม่ถูกแปลงเป็น zero.
- Observed zero ยังคงต่างจาก null.

## Tests

Focused tests ครอบคลุม:

- first attempt 32 pending และ next attempt zero;
- no writes during verification retry;
- persistent 32 pending fail closed หลัง exactly 5 attempts;
- bounded delays รวม 15000ms ภายใต้ 30000ms budget;
- sanitized diagnostics;
- Text, SingleSelect, integer Number, decimal `0.0000` และ null semantic equality;
- observed zero ไม่เท่ากับ null;
- `createRows>0` block;
- Stable key / allowed fields / exact confirmation;
- Preview planner remains read-only.

Current result:

```text
Focused backfill + serializer + sync engine    30/30 PASS
Full backfill + table discovery                16/16 PASS
Architecture / repository hygiene              PASS
Full unit                                      1436/1436 PASS
Workers runtime                                14/14 PASS
Report reliability                             100/100 PASS
Dependency audit                               0 vulnerabilities
Exact sync-config Wrangler dry-run             PASS / NO DEPLOYMENT
Repository example Wrangler dry-runs           PASS / NO DEPLOYMENT
Branch Verification CI                         PENDING
```

`npm test` ใน restricted sandbox ผ่าน Unit `1436/1436` ก่อน Workers runtime ถูก OS ปฏิเสธ
การเขียน Wrangler log และเปิด local `127.0.0.1` ด้วย `EPERM`. การ rerun
`npm run test:worker` นอก restricted sandbox ผ่าน `14/14`; ไม่มี Remote call หรือ deployment.

## Safety evidence

```text
Backfill Apply             NOT RUN
Remote Lark mutation       NONE
Remote D1 mutation         NONE
Worker deployment          NOT RUN
Queue/DLQ message          NOT SENT
Provider call              NONE
Schedule change            NONE
Secret change              NONE
Production/UAT             NOT RUN
Remote action count        0
```

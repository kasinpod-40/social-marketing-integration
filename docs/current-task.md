# Current Task — Lark Number Formatter Precision Canonicalization Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = LARK_NUMBER_FORMATTER_PRECISION_V1
BASE_MAIN_SHA                       = 1002cc9cfad0f07fdd1103f2601d642339e08686
INCIDENT_MAIN_SHA                   = 142d742fd27df9fdd1728a371836dd395dcc88ea
BRANCH                              = hotfix/lark-number-formatter-precision-v1
IMPLEMENTATION_PR                   = #248 / DRAFT
OPERATOR                            = scripts/lark-dashboard-shared-dimensions-backfill.mjs
OPERATOR_VERSION                    = lark-dashboard-shared-dimensions-backfill-v1.2
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
LARK_APPLY                          = BLOCKED
D1_WRITE                            = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
SCHEDULE_MUTATION                   = NONE
PRODUCTION_UAT                      = BLOCKED
```

## Objective

แก้ false update ของ Lark Number fields เมื่อ Lark เก็บ/อ่านค่ากลับตาม fixed precision ของ formatter เช่น `0.0000` แต่ validated materialization ยังมี precision มากกว่า โดย canonicalize เฉพาะ Lark storage/comparison contract และไม่แก้ Business value ใน D1.

## Confirmed root cause evidence

Read-only diagnostics ยืนยันบน Integration Workspace:

```text
source materializations                 2
matching Lark records                  32
coverage_rate missing/invalid          0
exact_equal                            0
equal_after_formatter_precision       32
0-1 vs 0-100 unit mismatch             0
Remote mutations                       0
```

ทั้ง 32 แถวมีค่า `coverage_rate` อยู่จริงใน Lark. ปัญหาเกิดจาก incoming raw precision เทียบกับค่าที่ Lark คืนตาม formatter `0.0000` ด้วย exact equality.

## Correction contract

- แก้ใน `packages/connectors/src/lark/lark-field-serializer.js` และไม่เพิ่ม global tolerance ใน `TableSyncEngine`.
- Canonicalize ทั้ง incoming serialization และ existing-record normalization ด้วย formatter precision เดียวกัน.
- รองรับเฉพาะ fixed numeric formatter ที่ระบุชัด เช่น `0`, `0.0000`, `#,##0.00`.
- Formatter percent/currency/custom ที่ไม่รองรับคง exact behavior เดิมและห้ามเดา precision.
- `null`/missing ยังต่างจาก observed `0`.
- NaN/Infinity ยัง fail closed.
- Normalize `-0` เป็น `0`.
- Stable keys, D1 payload/checksum, allowed fields และ Apply confirmation ไม่เปลี่ยน.

## Required validation

```text
Focused formatter/canonicalization tests
Focused TableSyncEngine plan regression
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npx wrangler deploy --dry-run --config wrangler.sync.jsonc --env development
Branch Verification CI
```

## Safety boundary

ห้ามรัน Backfill Apply, แก้ Remote Lark/D1, Deploy Worker, ส่ง Queue/DLQ, เรียก Provider, เปิด Schedule, แก้ Secret หรือทำ Production/UAT ระหว่าง Implementation.

## Recovery after merge

รัน read-only เท่านั้น:

```bash
node scripts/lark-dashboard-shared-dimensions-backfill.mjs
```

Expected:

```text
createRows       0
updateRows       0
recoveryDecision previous_apply_converged_no_apply_needed
```

เมื่อ `updateRows=0` ห้ามรัน Apply ซ้ำ.

รายละเอียด:

```text
docs/tasks/lark-number-formatter-precision-v1.md
```

## Implementation result

- Added formatter-aware Number canonicalization in the Lark serializer layer only.
- Added focused regressions for formatter parsing, decimal/integer canonicalization, negative zero, unsupported formatters, NaN/Infinity, null-vs-zero, formatter-equivalent skip and real-difference update.
- Remote action count during implementation remains `0`.
- Full validation and exact-head Branch Verification are pending.

## Completed parallel handoff — WooCommerce diagnostics Queue sentinel

PR `#247` was merged into `main` as `1002cc9cfad0f07fdd1103f2601d642339e08686`. The Preview-only entrypoint now has a fail-closed `queue(batch)` sentinel that calls `batch.retryAll()` exactly once without importing Business Queue runtime. This Lark hotfix does not modify WooCommerce diagnostics, Cloudflare config, Queue runtime or Production traffic.

---

# Historical Task Context — YouTube Lark Full-Sync UAT Operator

Historical implementation evidence remains in repository task documents and Git history. This section is non-authoritative for the active Lark Number formatter hotfix.

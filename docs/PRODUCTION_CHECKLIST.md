# MKT Production Readiness Checklist

Release จะยังไม่ถือว่า Production-ready จนกว่าจะตรวจครบทุก Gate

## สถานะ Package v0.6.0

### Architecture และ Code quality

- [x] ตรวจ Codebase ทั้งหมดก่อนแก้
- [x] ไม่พบ Circular dependency หรือ Dependency ย้อนจาก Domain/Shared
- [x] ไม่มี Duplicate file contents, Dead placeholder หรือ Build artifact ใน Package working tree
- [x] Business logic ไม่อ่าน `process.env` โดยตรง
- [x] Runtime config และ Customer profiles มีคอมเมนต์ภาษาไทย
- [x] Function contract และ Logic สำคัญ/เสี่ยงมีคอมเมนต์ภาษาไทย
- [x] Architecture audit ถูกรวมใน `npm run check`

### Data contract

- [x] Source URL/Rich text/Number cell shape รองรับข้อมูล Lark ที่พบจริง
- [x] Field type, Select options, URL/Date contract ใช้ Live schema preflight
- [x] Stable key, Source handle, Account mismatch และ Legacy stable-key conflict มี Guard
- [x] Date/Timezone ใช้ Asia/Bangkok ตาม Contract
- [x] Metric Null semantics และ Unique viewer semantics ชัดเจน
- [x] Report key และ JSON payload มี Collision/Data-loss guard

### Dev และ Production

- [x] DEV profile ใช้ `dev_ft_pumkin`
- [x] Production profile ใช้ `chemistry_k`
- [x] `MKT_ENV` และ `MKT_CUSTOMER_PROFILE` จับคู่แบบ Fail-fast
- [x] Customer-owned Production rule บันทึกใน PROJECT_BRAIN
- [x] Connector Catalog/Feature flags แยก TikTok, Facebook, Instagram, YouTube, WooCommerce และ Chatwoot
- [x] Connector ที่ยังเป็น planned เปิดใช้งานไม่ได้และไม่คืน Fake success
- [x] TikTok source handle Override ผ่าน Environment ได้โดยไม่แก้ Stable account key
- [x] Secret ไม่อยู่ใน Source code/ZIP working tree

### Reliability และ Performance

- [x] Preflight Content/Daily ก่อน Write แรก
- [x] Pagination ตรวจ `has_more`, token ซ้ำ และ max pages
- [x] Destination lookup ใช้ Filtered Stable-key search
- [x] Batch size, Rate limit, Retry-After และ Timeout มี Regression tests
- [x] Response body อยู่ภายใต้ Timeout
- [x] Create request ไม่ Retry แบบกำกวม
- [x] Queue Retry เฉพาะ Transient error
- [x] Sync Queue consumer จำกัด `max_concurrency=1` และมี Regression test
- [x] Input/Destination duplicate และ Destination identity conflict มี Guard
- [x] Empty Multi-select/URL shape ไม่สร้าง False update
- [x] Plan เดิม Execute ซ้ำไม่ได้
- [ ] Benchmark/Load test เมื่อข้อมูลเพิ่ม 10x และ 100x (ไม่ Block DEV/Staging deploy รอบแรก)
- [x] D1 cursor/fingerprint Incremental processing พร้อม Full reconciliation 24 ชั่วโมง (RAW traversal ยัง Full เพื่อ Safety)
- [x] Distributed lease lock บน D1 พร้อม owner-scoped renewal/heartbeat ก่อนเพิ่ม Queue concurrency
- [x] Persisted `MKT_Sync_Log`, `sync_run_id`, DLQ alert และ Reconciliation summary
- [ ] ยืนยัน Lark Cell-clear contract และเพิ่ม Classification field clearing โดยไม่ลบค่าผิด Field

### Test และ Release package

- [x] Node Unit/Integration/Regression tests และ Workers-runtime tests ผ่านก่อน Packaging
- [x] Syntax check ผ่านก่อน Packaging
- [x] Architecture audit, repository hygiene และ Wrangler 4.110.0 dry-run ผ่านก่อน Packaging
- [x] สร้าง ZIP โดยไม่มี `.dev.vars`, Secret, `node_modules`, Log หรือไฟล์ขยะ
- [x] แตก ZIP ใหม่แล้ว Test/Check ผ่านซ้ำ
- [x] บันทึก SHA-256 ของ ZIP ไว้นอก Archive หลังสร้าง Release ขั้นสุดท้าย

### Live DEV gate หลังติดตั้ง ZIP

- [x] Baseline v0.4.0 ยืนยัน TikTok=true และ Connector ที่ยัง planned=false ทั้งหมด

- [x] Baseline v0.4.0 `npm run validate:tiktok` ผ่านกับ DEV Base จริง
- [x] Baseline v0.4.0 Source identity เป็น `ft.pumkin`
- [x] Baseline v0.4.0 ไม่มี skipped rows/issues/destination identity conflicts
- [x] Baseline v0.4.0 Sync จริงรอบแรกผ่าน
- [x] Baseline v0.4.0 Sync รอบสอง `created=0`, `updated=0`, `skipped=20`
- [x] Baseline v0.4.0 จำนวน Content/Daily ไม่เพิ่มจาก Stable Key เดิม


### Live DEV reliability gate ของ v0.5.0/v0.5.1

- [x] เพิ่ม `LARK_TABLE_MKT_SYNC_LOG` และ `LARK_TABLE_MKT_SYSTEM_ALERTS` ใน `.dev.vars`
- [x] Local write สร้าง `sync_run_id` และ Upsert `MKT_Sync_Log` จาก `running` เป็น `success`
- [x] รันซ้ำแล้ว Content/Daily ไม่ Create หรือ Update ซ้ำ
- [x] เปิดสอง Terminal พร้อมกันแล้วรอบที่ชน Lock ได้ `SYNC_LOCK_BUSY` โดยไม่เขียนข้อมูลธุรกิจ
- [x] จำลอง Source identity error แบบปลอดภัยและตรวจว่า `MKT_System_Alerts` ได้ Alert พร้อม `sync_run_id`
- [x] Apply `0002_reliability.sql` กับ D1 DEV resource จริงสำเร็จ
- [x] Queue Retry, DLQ persistence, D1/Lark Alerts และ D1 lease lock ผ่าน Cloudflare DEV UAT

- [x] Wrangler config อยู่ root และ `npm run deploy:dry-run` ผ่าน
- [x] D1 เป็น Primary ส่วน Lark เป็น best-effort mirror
- [x] Chunk-level partial write, strict Queue/DLQ routing และ lease renewal มี Regression tests
- [x] Scheduled handler enqueue งานเข้า Queue producer จริง
- [x] Workers-runtime tests ครอบ Main Queue, DLQ, Unknown Queue, Active routing และ Scheduled producer


### Live DEV incremental gate ของ v0.6.0

- [ ] Apply `0003_incremental_sync.sql` กับ D1 DEV resource จริง
- [ ] รอบแรกสร้าง Full checkpoint (`initial_checkpoint`) สำเร็จ
- [ ] รอบไม่มีการเปลี่ยนแปลงเลือก 0 records และไม่ทำ Destination I/O
- [ ] แก้ RAW หนึ่งรายการแล้วเลือก/อัปเดตเฉพาะรายการนั้น
- [ ] Scheduled Incremental Sync ผ่านต่อเนื่องอย่างน้อย 3 รอบ
- [ ] ตรวจ `sync_cursors`, `source_record_states`, `sync_locks` และไม่มี Alert ผิดปกติ

### Customer-owned Production gate

- [ ] ลูกค้าสร้าง Production Lark Base/App/Cloud/Platform assets
- [ ] ตั้ง Production Variables/Secrets ใน Account ลูกค้า
- [ ] ตรวจ Field/Table mapping กับ Base ลูกค้าจริง
- [ ] Dry run ผ่านใน Production
- [ ] UAT/Approval จากลูกค้าก่อนเปิด Schedule/Queue จริง

## v0.7.1 Report & Runtime Reliability Gate

- [x] First report-table rejection is `failed`, not `partial_success`
- [x] Scheduled job payload binds `metricDate` / `periodEnd` to original `scheduledTime`
- [x] Top Content limit is shared, bounded 1–100, and stale ranks become `no_data`
- [x] Lease expiry fails closed before additional writes
- [x] Chunk guard failure preserves confirmed write progress
- [x] Exhausted Lark 1254290 remains retryable rejection, not ambiguous write
- [x] Local lock mutations use an exclusive guard to prevent renewal/takeover race
- [x] Repository hygiene rejects tracked `.dev.vars` and `wrangler.sync.jsonc`
- [x] Wrangler example enables persisted DEV Logs and Traces
- [ ] Apply observability block and appropriate sampling to customer-owned Production config
- [ ] Lark report schema, seed, manual Daily/Weekly UAT, and idempotent rerun pass
- [ ] Report schedules remain `false` until all Report UAT items pass

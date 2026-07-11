# MKT Production Readiness Checklist

Release จะยังไม่ถือว่า Production-ready จนกว่าจะตรวจครบทุก Gate

## สถานะ Package v0.3.1

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
- [ ] Benchmark/Load test เมื่อข้อมูลเพิ่ม 10x และ 100x
- [ ] Incremental RAW source cursor/window
- [ ] Distributed lock/Unique reservation ก่อนเพิ่ม Queue concurrency หรือเปิด Writer หลาย Runtime
- [ ] Persisted `MKT_Sync_Log`, `sync_run_id`, DLQ alert และ Reconciliation summary
- [ ] ยืนยัน Lark Cell-clear contract และเพิ่ม Classification field clearing โดยไม่ลบค่าผิด Field

### Test และ Release package

- [x] Unit/Integration/Regression tests 140/140 ผ่านก่อน Packaging
- [x] Syntax check ผ่านก่อน Packaging
- [x] Architecture audit ผ่านก่อน Packaging
- [x] สร้าง ZIP โดยไม่มี `.dev.vars`, Secret, `node_modules`, Log หรือไฟล์ขยะ
- [x] แตก ZIP ใหม่แล้ว Test/Check ผ่านซ้ำ
- [x] บันทึก SHA-256 ของ ZIP ไว้นอก Archive หลังสร้าง Release ขั้นสุดท้าย

### Live DEV gate หลังติดตั้ง ZIP

- [ ] `npm run validate:tiktok` ผ่านกับ DEV Base จริง
- [ ] Source identity เป็น `ft.pumkin`
- [ ] ไม่มี skipped rows/issues/destination identity conflicts
- [ ] Sync จริงรอบแรกผ่าน
- [ ] Sync รอบสอง `created=0`
- [ ] จำนวน Content/Daily ไม่เพิ่มจาก Stable Key เดิม

### Customer-owned Production gate

- [ ] ลูกค้าสร้าง Production Lark Base/App/Cloud/Platform assets
- [ ] ตั้ง Production Variables/Secrets ใน Account ลูกค้า
- [ ] ตรวจ Field/Table mapping กับ Base ลูกค้าจริง
- [ ] Dry run ผ่านใน Production
- [ ] UAT/Approval จากลูกค้าก่อนเปิด Schedule/Queue จริง

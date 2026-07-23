# Storage Architecture Contract Review v1

## Status

```text
REVIEW_STATUS = PASS_WITH_IMPLEMENTATION_GATES
AUTHORITATIVE_CONTRACT = storage-architecture-and-migration-contract-v1.md
CODE_CHANGE = NONE
```

เอกสารนี้บันทึกผลตรวจทาน Contract ก่อนเปิด PR และไม่เปลี่ยน Grain หรือ Table names ที่อนุมัติแล้ว

## Clarifications locked for implementation

### Deterministic observation identity

`observed_at` ใน `organic_content_observations` ต้องมาจาก Source observation/checkpoint instant ที่ Persist อยู่ใน durable work input ไม่สร้างใหม่จากเวลา Retry

Retry ของ Work generation เดิมต้องใช้:

```text
same content_key
same observed_at
same observation_kind
same observation_key
```

ดังนั้น Queue retry หรือ Worker restart ห้ามสร้าง Observation ใหม่

### Mandatory checkpoints

Sparse observation ต้องมี mandatory checkpoint policy ต่อ Connector เพื่อให้ Historical query พิสูจน์ค่าปลายช่วงได้แม้ Metric ไม่เปลี่ยน

Policy จริงต้องอยู่ใน Connector contract และต้องไม่อ้างว่า Run แบบ recent-window ครอบคลุม Content ทั้งบัญชี

### JSON bounds

Implementation ต้องมี Application-level byte guards ก่อน D1 write:

```text
report_materializations.payload_json <= 262144 bytes
actions_json <= 65536 bytes
breakdown_json <= 65536 bytes
```

Payload เกิน Limit ต้อง Fail closed หรือ Materialize เฉพาะ approved KPI/Top rows ห้ามตัด JSON แบบเงียบ

### Attribution identity

เมื่อ Source สามารถคืนหลาย Attribution setting สำหรับ Entity/Date เดียวกัน ต้องรวม `attribution_setting_key` ใน `segment_key` หรือออก Contract revision เพิ่ม Column/Stable-key component ก่อนเปิด Writer

ห้าม Collapse Attribution variants ลง Fact เดียว

### Metric extensibility

Canonical columns ใน v1 เป็น Metrics ที่ Dashboard ใช้ร่วมกัน ส่วน Metric เพิ่มเติมต้อง:

- มี Definition/version;
- ใช้ bounded JSON หรือ Table contract ที่อนุมัติ;
- ไม่เปลี่ยนความหมายของ Canonical columns;
- ไม่ Commit Raw secret/personal payload;
- ไม่เพิ่ม Field/Column แบบไม่มี Reader/retention contract.

### Coverage proof

Full-inventory Coverage proof ใช้ได้เมื่อ Source traversal พิสูจน์ expected/observed scope ครบและ `organic_content_state.last_coverage_run_id` ถูกอัปเดตเฉพาะ Entity ที่ตรวจจริง

Recent-window/partial traversal ต้องใช้ `data_coverage_entities` สำหรับ Exact scope ที่ถูกตรวจ ห้ามใช้ Run-level complete แทนทั้งบัญชี

### Lark Dashboard behavior

Preset `3D/7D/9D/15D/30D/90D` ต้องถูก Materialize ล่วงหน้าสำหรับการกดดูทันทีใน Lark

`CUSTOM_RANGE` เป็น queued request และแสดงผลหลัง `report_requests.status=completed`; Lark ไม่ Query D1 detailed facts โดยตรง

### Retention

ค่า “อย่างน้อย 400 completed days” ของ `MKT_Account_Daily` และ `MKT_Report_*` เป็น Functional target ไม่ใช่สิทธิ์เปิด Auto-delete

Exact deletion threshold ยัง Block จน D1/Lark capacity, backup, parity และ rollback evidence ผ่าน

## Implementation review gates

ก่อน Merge แต่ละ Implementation PR ต้องตรวจ:

- Schema matches exact Contract;
- Migration replays on empty and existing D1;
- Stable keys remain deterministic on retry;
- Indexes support account/date and entity/date query paths;
- no unbounded JSON;
- Coverage does not overclaim scope;
- manual Lark fields are preserved;
- all new flags default false;
- no Live write from unit tests/dry-run;
- report parity includes all required periods;
- rollback remains possible before retention.

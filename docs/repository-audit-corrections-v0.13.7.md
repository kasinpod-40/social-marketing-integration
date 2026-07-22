# Repository Audit Corrections v0.13.7 — 2026-07-22

## Status

- **Status:** `merged_and_verified`
- **Merged PR:** `#13`
- **Merged commit:** `d4a531fbb4e05dad7ce2296859c97f571e23acf3`
- **Merge method:** squash
- **Scope:** documentation accuracy, Google Ads View safety guard and reproducible handoff
- **Live Lark mutation:** none
- **Google Ads mutation:** none
- **Worker/Queue/D1/deployment mutation:** none
- **Production mutation:** none

เอกสารนี้แก้ความคลาดเคลื่อนที่พบหลังตรวจ Repository ทั้งระบบและตรวจ `Social MKT Data Hub(11).base` แบบ configuration-only.

## Corrected current facts

### Lark DEV closeout

- Physical tables: `42`
- Fields: `737`
- Views: `133`
- Filtered Views: `42`
- Sorted Views: `6`
- Views with hidden fields: `7`
- Table emoji/folder placement: `42/42`
- View emoji names: `133/133`
- Google Ads Formula fields: `4/4`
- Google Ads managed filters: `19/19`
- Shared-table managed filters: `17/17`
- Report Views: `6/6`
- Google Ads Daily 30D: `platform=google_ads AND metric_date=TheLastMonth`

### View contract interpretation

133 Views แบ่งเป็น:

- Shared-table managed: `17`
- Report managed: `6`
- Google Ads managed: `19`
- All/default baseline: `36`
- Legacy specialized baseline: `55`

42 filtered Views เท่ากับ `17 + 6 + 19`.

คำว่า Full View contract หมายถึง managed contracts และ baseline-preservation ครบทุก View ไม่ได้แปลว่า Specialized Views 55 รายการมี Business Filter ตามชื่อแล้ว. กลุ่มนี้ต้องมีงาน Business-owner contract แยกก่อนแก้ Filter/Sort/Hidden fields.

### Google Ads direct API access

ข้อมูลที่ถูกต้อง:

- Basic Access application submitted: `2026-07-21`
- Case ID: `1-686800040839`
- Cloud project number: `788131774873`
- Review status: `pending`
- Current developer-token level: `Test Account Access`
- Manager Script MVP ไม่รอ direct API approval

ข้อความเดิมที่ระบุว่า “No access application was submitted” ถูกยกเลิกโดยเอกสารนี้และ `docs/current-task.md`.

### Google Ads Manager Script evidence level

Live UI UAT ยืนยัน:

- authorized advertiser selectable;
- six bounded datasets returned non-empty data;
- dataset errors/truncation `0/0`;
- Preview showed `No changes`;
- Frequency `—`;
- no external delivery was enabled.

อย่างไรก็ตาม sanitized 598-line Script source ยังไม่ได้ Commit จึงต้องเรียก Safety scan นี้ว่า `documented_live_review`, ไม่ใช่ independently reproducible source audit. งาน signed delivery ถัดไปต้องเพิ่ม sanitized source snapshot หรือ immutable checksum/query/output manifest ก่อนเปิด external delivery.

## Google Ads View safety correction

คำสั่ง `setup-google-ads-view-filters` มี Scope เป็น update-only. Generic View installer รองรับ Create สำหรับงานอื่น จึงเพิ่ม Guard เฉพาะ Google Ads:

- Pre-Apply Preview ต้อง `createViews=0`;
- ทุก Action ต้องเป็น `update_view`;
- missing View คืน Permanent blocker `GOOGLE_ADS_VIEW_FILTER_VIEW_MISSING_NO_CREATE`;
- wrapped client ปฏิเสธ `createView` ด้วย `GOOGLE_ADS_VIEW_FILTER_CREATE_FORBIDDEN` เพื่อป้องกัน race ระหว่าง Preview กับ Apply.

ไม่มีเหตุผลให้ rerun Live Apply หลัง Lark DEV zero drift ผ่านแล้ว. Guard นี้มีไว้ป้องกัน future maintenance.

## RAW error View coverage decision

Google Ads RAW error Views 13 รายการใช้ **stable-key-only minimum contract**:

- conjunction `and`;
- Primary raw stable key `isEmpty`;
- ไม่มี multi-field status/customer/entity validation ใน View เดียวกัน.

Contract นี้ใช้ตรวจ missing canonical raw identity ไม่ใช่ comprehensive data-quality validation. หากต้องการตรวจ customer ID, entity ID, status, report level, segment key หรือ policy state ให้สร้าง Data Quality contract/workstream แยกและห้ามเปลี่ยนความหมายของ View ปัจจุบันโดยไม่มี approval.

## Dependency security correction

Branch Verification พบ High vulnerabilities ใน transitive `sharp <0.35.0` chain. PR #13:

- เพิ่ม `overrides.sharp=0.35.3`;
- refresh `package-lock.json`;
- เก็บ `audit.log` ใน CI diagnostics;
- ผ่าน dependency audit ด้วย `0 vulnerabilities`.

## Version clarification

- Root package version `0.11.0` คือ application release line ปัจจุบัน.
- `v0.13.5`, `v0.13.6`, `v0.13.7` เป็น Lark schema/view/formula/audit contract versions.
- ห้ามอนุมานว่า package release ถูก bump จากเลข Contract โดยอัตโนมัติ.

## Verification result

Final PR head `0835957df06db02c57d37bf5ce47380642ed418b` passed Branch Verification run `171`:

```text
npm ci                         PASS
npm run check                  PASS
Focused staged TikTok           4/4 PASS
Node Unit/Integration         540/540 PASS
Workers runtime                 9/9 PASS
Report reliability             70/70 PASS
npm audit --audit-level=high    0 vulnerabilities
npm run deploy:dry-run          PASS
```

No Live Apply or deployment occurred.

## Next approval gate

`Google Ads Manager Script signed delivery connector`

ก่อน Implementation ต้องล็อก:

1. six-dataset payload schema and schema version;
2. HMAC signature, timestamp, nonce and replay window;
3. bounded batch and payload size;
4. null semantics;
5. stable key/idempotency key;
6. partial-write/retry classification;
7. Queue/DLQ/checkpoint/lock/reconciliation;
8. retention/redaction/audit;
9. DEV/UAT/Production ownership;
10. schedule disabled by default.

No new Connector task is active until the user approves this scope.

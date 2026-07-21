# AGENTS.md — Social Marketing Data Integration

ไฟล์นี้เป็นกฎการทำงานร่วมกันของ ChatGPT Work, Codex และผู้พัฒนาทุกคนใน Repository นี้ และมีผลกับทั้ง Repository

## 1. ลำดับการอ่านก่อนเริ่มงาน

ก่อนวิเคราะห์ แก้โค้ด หรือออก Release ต้องอ่านตามลำดับ:

1. `AGENTS.md`
2. `docs/current-task.md`
3. `PROJECT_BRAIN.md`
4. ไฟล์ Modular Project Brain ที่เกี่ยวข้องใน `docs/project-brain/`
5. `README.md` และ `CHANGELOG.md`
6. Source code และ Tests ที่เกี่ยวข้องทั้งหมด

ห้ามเริ่ม Implementation จากข้อความในแชทเพียงอย่างเดียวเมื่อ Repository มีข้อมูลใหม่กว่า

## 2. แหล่งความจริงและลำดับอำนาจ

เมื่อข้อมูลขัดกัน ให้ใช้ลำดับนี้:

1. คำสั่งล่าสุดที่ชัดเจนของผู้ใช้
2. Scope และ Acceptance criteria ใน `docs/current-task.md`
3. กฎใน `AGENTS.md`
4. สถานะ/Architecture/Decision ใน `PROJECT_BRAIN.md` และ `docs/project-brain/`
5. README, CHANGELOG และเอกสารรุ่นเก่า

เอกสารประวัติรุ่นเก่าอาจบันทึกสมมติฐานที่ถูกแก้ภายหลัง ห้ามนำมาแทน Current verified state

## 3. Workflow ระหว่าง Work และ Codex

### ChatGPT Work รับผิดชอบ

- วิเคราะห์ Requirement, Scope, Data model, Architecture และความเสี่ยง
- เขียนหรือปรับ `docs/current-task.md` ให้มี Objective, In scope, Out of scope, Contract, Acceptance criteria และ Required tests
- ตรวจผลลัพธ์ทางธุรกิจ, UAT, Regression และ Release handoff
- อัปเดต Project Brain, README, CHANGELOG และเอกสารส่งมอบ

### Codex รับผิดชอบ

- อ่าน Repository ตามลำดับด้านบนก่อนแก้ไฟล์
- ตรวจทั้ง Codebase ก่อนเพิ่มโค้ดใหม่
- แก้ Implementation, Refactor, Tests, Migration และ Tooling ใน Repository จริง
- รัน Gate ที่กำหนดและบันทึกผลใน `docs/current-task.md`
- รายงาน Files changed, Commands run, Tests, Live UAT, Remaining risks และ Commit suggestion

### กติกาส่งงานกลับ

เมื่อ Codex ทำงานเสร็จ ต้องอัปเดตหัวข้อ `Implementation result` ใน `docs/current-task.md` ก่อนถือว่าส่งงานให้ Work ตรวจได้

## 4. ก่อนเริ่ม Coding ทุกครั้ง

ต้องตรวจอย่างน้อย:

- Duplicate logic และโค้ดที่ควรใช้ Shared module
- Dead/unused code, empty files, stale imports และ unnecessary files
- Architecture direction และ circular dependencies
- Performance, pagination, batching, bounded concurrency และ memory usage
- Security, permissions, secrets, rate limits, retries, timeout และ partial failure
- Stable keys, idempotency, reconciliation, sync log และ observability
- ผลกระทบต่อ DEV/UAT/Production profiles และทุก Connector/Job ที่ใช้ Contract กลาง

ห้ามเพิ่ม Utility หรือ Layer ใหม่เมื่อขยายของเดิมได้อย่างสะอาดกว่า

## 5. กฎ Data Model ก่อน Connector

ก่อนเขียน Connector หรือเพิ่มแหล่งข้อมูลใหม่ ต้องทำ Data Model/Lark Base Design ให้เสร็จก่อนเสมอ:

- Raw table / Master table / Daily snapshot / Sync log / Alerts
- Field name, field type, required, stable key และ idempotency key
- Metric definition, null semantics, import note และ example value
- Relation, lookup, formula และ View/Permission ที่ต้องตั้งใน Lark
- Customer profile, non-secret mapping และ Feature flag
- Blueprint/contract ที่ตรวจทานแล้ว

ห้ามเริ่ม Connector Implementation หาก `docs/current-task.md` ยังระบุว่า Data model หรือ Source contract ยังไม่อนุมัติ

## 6. Environment, Ownership และ Secret

- DEV ปัจจุบันใช้ profile `dev_ft_pumkin` และทรัพยากร/ข้อมูลของผู้พัฒนา
- Customer-real UAT ใช้ profile `uat_chemistry_k`: บัญชีต้นทางและข้อมูลเป็นของลูกค้า แต่ Lark Base และ Cloudflare UAT เป็นของผู้พัฒนาชั่วคราวและต้องแยกจาก DEV
- Production ใช้ profile `chemistry_k` และต้องใช้ Lark Base, Cloudflare, App credentials และ Platform assets ที่ลูกค้าเป็นเจ้าของ
- UAT เป็นข้อมูลจริง ไม่ใช่ Sandbox/Demo; ต้องใช้ Security, Least privilege, Audit, Retention และ Cleanup ระดับ Production
- `profileKey` อาจต่างกันระหว่าง UAT/Production แต่ `customerKey` และ Connector `accountKey` ต้องคงเดิมเพื่อรักษา Canonical stable keys
- DEV, UAT และ Production ต้องแยก Worker, D1, Queue, DLQ, Secrets, Checkpoint, Lock, Alert, Schedule และ Lark Base
- UAT Connector ทุกช่องทางและ Schedule ทุกตัวต้องปิดโดย Default จนกว่า Identity/Source-contract preflight ของช่องทางนั้นจะผ่าน
- เก็บเฉพาะ non-secret IDs/mappings ใน Source
- Token, API key, password, app secret, OTP, session cookie และ credential ต้องอยู่ใน Environment/Secret store เท่านั้น
- ห้าม Commit `.dev.vars` หรือ `wrangler.sync.jsonc`
- ห้ามเปิดเผย Secret, Token, Customer identity หรือข้อมูลส่วนบุคคลใน Log/Health/Admin response
- Contract รายละเอียดของ UAT อยู่ที่ `docs/project-brain/customer-real-uat.md`

## 7. Connector และ Queue contract

- Native-first, custom-fallback
- Connector ที่ยังไม่เสร็จต้องเป็น `planned` และ Feature flag เป็น `false`
- ห้าม Fake success, Dummy production data หรือ Placeholder write
- Job type ต้องประกาศใน Job Catalog กลาง ห้ามกระจาย String literal ซ้ำ
- Unknown job/schema version ต้องเป็น Permanent error
- ทุก Write path ต้องมี Stable key, idempotency, retry classification และ partial-write semantics ที่ทดสอบได้
- Missing metric ใช้ `null`/N/A ไม่ใช่ `0` เว้นแต่ Contract ระบุว่าศูนย์เป็นค่าจริง

## 8. Lark/OpenAPI verification rule

บทเรียนที่ยืนยันจาก Live tenant:

- ห้ามอนุมาน Request schema จาก Response metadata
- Request ของ View filter ส่งเฉพาะ Request fields ที่ API รองรับ
- Checkbox filter ต้องรักษาชนิด Boolean เช่น JSON-array string `[true]` ไม่ใช่ `["true"]`
- List Views อาจไม่คืน `property`; ต้อง Get View เพื่อ hydrate state ก่อนตรวจ Idempotency
- Filter และ Hidden fields ใช้ Mutation แยกเพื่อระบุ Failure stage ชัดเจน
- Error generic เช่น `1254001 WrongRequestBody` ยังไม่ใช่ Root cause

ห้ามประกาศว่า “ยืนยัน Root cause แล้ว” จนกว่า Minimal live reproduction หรือ Live Apply ผ่านจริง หากยังไม่ผ่านให้เรียกว่า `hypothesis` และเก็บ diagnostics ที่ไม่เปิดเผย Secret

## 9. Definition of Done

งาน Implementation จะถือว่าเสร็จเมื่อ:

- Scope และ Acceptance criteria ผ่านครบ
- Unit/Integration และ Workers-runtime tests ผ่าน
- Focused regression suite ที่เกี่ยวข้องผ่าน
- `npm run check` ผ่าน รวม Architecture และ Repository hygiene
- `npm audit` ไม่มีช่องโหว่ที่ยอมรับไม่ได้
- `npm run deploy:dry-run` ผ่าน
- Live/Sandbox/UAT ผ่านเมื่อ Scope ต้องใช้ External API
- ไม่มี duplicate logic, dead files, local config, Secret หรือ build artifact ใน Release
- `docs/current-task.md`, Project Brain และ CHANGELOG อัปเดต

Default gates:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm run deploy:dry-run
```

เพิ่ม Focused tests ตาม Feature ที่แก้ ห้ามลด Gate เพื่อให้ Release ผ่าน

## 10. Release และ Git

- Release ZIP ต้องไม่มี `.dev.vars`, `wrangler.sync.jsonc`, `.git`, `.wrangler`, `node_modules`, `.DS_Store`, `__MACOSX` หรือ AppleDouble files
- แตก ZIP ปลายทางแล้วรัน Gate ซ้ำก่อนส่ง
- แนบ SHA-256 ทุก Release
- Commit message ใช้แบบสั้น กระชับ และตรงงาน
- ทุก Release ต้องมีคำสั่ง `git add`, `git commit`, `git push` พร้อมใช้

## 11. ภาษากับ Comments

- เอกสารและคำอธิบายสำหรับผู้ใช้ใช้ภาษาไทยเป็นหลัก
- Config blocks และจุด Mapping ลูกค้าใช้คอมเมนต์ภาษาไทยที่อธิบายหน้าที่และข้อจำกัด
- Comments ต้องอธิบายเหตุผล/Contract ไม่ใช่แปลทุกบรรทัดหรือบรรยาย Syntax

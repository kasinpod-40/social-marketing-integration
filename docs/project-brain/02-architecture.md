# 02 — Architecture

## Style

Clean Architecture + Monorepo + Modular Monolith

## Package direction ที่ใช้จริง

- `apps/api-worker`: HTTP health/status และ Queue producer ในอนาคต
- `apps/sync-worker`: cron, queue consumer และ sync orchestration
- `packages/domain`: Entity/Value object ที่ไม่พึ่ง Infrastructure
- `packages/application`: Use case, Connector registry และ Queue job contract
- `packages/sync-engine`: Plan/Diff/Execute ที่ไม่ผูกกับ Storage
- `packages/connectors`: Lark และ Platform adapters
- `packages/config`: Customer profile, Connector catalog, table mapping และ build info
- `packages/shared`: Date, Number, Error และ HTTP utilities กลาง

Directory ที่ยังไม่มี Implementation จริงจะไม่สร้างเป็นไฟล์เปล่าหรือ Placeholder

## Dependency rule

- Shared ห้ามพึ่ง Layer อื่น
- Domain พึ่งได้เฉพาะ Domain/Shared
- Config พึ่งได้เฉพาะ Config/Shared
- Sync engine พึ่งได้เฉพาะ Sync engine/Shared
- Apps ประกอบ Application, Config, Connector และ Infrastructure ตอน Runtime
- Dependency graph ต้องไม่มีวงจรและผ่าน `npm run audit:architecture`

## Multi-channel control plane

```text
Customer Profile
    + Environment Feature Flags
    -> Connector Runtime Config
    -> Connector Registry
    -> Queue Job Catalog
    -> Use Case จริงของ Connector
```

กฎสำคัญ:

- Connector ที่ `planned` เปิดใช้ไม่ได้
- Job ที่ `planned` ไม่ถูก Route ไป Infrastructure
- Connector ต้องผ่าน Data Model/Blueprint ก่อนสร้าง API adapter และ Lark mapping
- Stable account key อยู่ใน Customer profile
- Platform identity ที่เปลี่ยนตามบัญชีจริงใช้ Environment override

## Data flow

```text
Platform / Native Raw Table
    -> Connector Adapter
    -> Normalized Model
    -> Application Use Case
    -> Sync Plan
    -> Lark Writer
    -> Daily Snapshot
    -> Dashboard / Report / AI Summary
```

## Durable large-account work flow

Connector ที่ต้องเดินหลาย page/chunk ใช้ shared `sync_work_runs` / `sync_work_phases` / `sync_work_units` ใน D1:

```text
External page/chunk
    -> Atomic staged unit + progress
    -> Resume unfinished unit after Queue retry
    -> Read staged units in bounded pages
    -> Plan every destination table
    -> Business writes
    -> Business checkpoint
    -> Clear work staging
```

`sync_work_*` ไม่ใช่ Source-of-truth checkpoint. Connector ห้ามเลื่อน `sync_cursors` หรือ `source_record_states` ก่อน Business writes สำเร็จ และห้ามทำ pagination/retry state machine ซ้ำเมื่อ shared work store รองรับอยู่แล้ว.

## Google Ads signed delivery flow

```text
Google Ads Manager Script (exact account, read-only)
    -> DRY_RUN counts only
    -> signed PREVIEW / manual LIVE
    -> API Worker raw-body HMAC + timestamp + nonce/replay + schema
    -> D1 durable delivery payload/idempotency
    -> reference-only Queue job
    -> shared D1 reliability + distributed lock + DLQ/redrive
    -> plan all 12 Lark destinations
    -> stable-key writes
    -> per-table reconciliation
```

The API Worker never puts the signing secret, signature, nonce or raw payload on the Queue. PREVIEW is terminal with zero business writes. The connector reuses the central TableSyncEngine and reliability path; it does not create a second retry/lock/DLQ system.

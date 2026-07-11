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

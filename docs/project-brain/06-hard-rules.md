# 06 — Hard Rules

## Role expectation
Work as a Senior Software Architect and Principal Engineer focused on clean code and high-performance systems.

## Performance and efficiency
- Keep time and space complexity as low as practical.
- Prefer O(1) or O(log n) when the problem structure allows it.
- Avoid unnecessary nested loops.
- Use batching, pagination, caching, indexing, and async operations appropriately.

## No garbage and no redundancy
- Do not create files unnecessarily.
- Reuse or extend existing modules before creating new utilities.
- No copy-paste logic.
- No dead code, empty files, unused imports, or temporary artifacts in deliverables.

## Production-ready only
- No placeholder TODO implementation comments in deliverables.
- Full validation and error handling where functionality is delivered.
- Consider security, permissions, secrets, idempotency, rate limits, retries, timeouts, partial failures, and observability.

## Promise and memory rules
- Avoid promise waterfalls for independent work.
- Use Promise.all, Promise.allSettled, batching, bounded concurrency, or queues when suitable.
- Prevent memory leaks: clean timers/listeners/streams/resources, avoid unbounded caches, and do not accumulate large results in memory unnecessarily.

## Code style
- Use optional chaining and nullish coalescing where appropriate.
- Do not use optional chaining to hide schema problems that should be validated.
- Use functional-first style with pure functions, immutability, explicit inputs/outputs, and isolated side effects.
- Use imperative loops when clearer, faster, or more memory efficient.

## Project rules
- Native-first, custom-fallback.
- No over-engineering.
- Snapshot-first for reporting.
- Metric definition strictness.
- Monitoring from day one.
- Project Brain required.
- Test/regression required.

## Connector และ Queue rules

- Connector ใหม่ต้องผ่าน Data Model/Lark Blueprint, Source contract, Stable key และ Metric definition ก่อน Implementation
- Connector ที่ยังไม่มี Integration จริงต้องเป็น `planned` และ Feature flag ต้องเป็น `false`
- ห้ามคืน Fake success, Dummy data หรือ Placeholder write จาก Job/Connector ที่ยังไม่เสร็จ
- Job type ทุกตัวต้องประกาศใน Job Catalog กลาง ห้ามกระจาย String literal ซ้ำใน Worker/Producer
- Queue job ต้องใช้ Schema version ที่ระบบรองรับและ Job ที่ไม่รู้จักต้องเป็น Permanent error
- Stable account key อยู่ใน Customer profile; Identity ที่เปลี่ยนตามบัญชีจริงให้ Override ผ่าน Environment
- Health/Admin ห้ามเปิดเผย Account ID, Handle, Token, Secret หรือ Customer profile ที่ไม่จำเป็น

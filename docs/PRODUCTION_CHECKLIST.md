# MKT Production Readiness Checklist

Connector หรือ Release จะยังไม่ถือว่าเสร็จจนกว่าจะตรวจครบตามรายการนี้

- Architecture และ codebase audit
- ตรวจ code ซ้ำ, dead code, unused files และ shared logic
- Source API contract และตัวอย่างค่าจริง
- Lark Base field contract ทุก field
- Runtime profile และ Dev/Production separation
- Secrets ไม่อยู่ใน source code หรือ ZIP
- Pagination, batching, rate limit, retry และ timeout
- Idempotency และ duplicate protection
- Schema-aware serialization และ preflight
- Error message, tracing และ sync log
- Unit, integration และ regression tests
- Dry run กับ Lark Base จริง
- Sync จริงรอบแรกและ idempotency รอบสอง
- Performance/API call review
- PROJECT_BRAIN, CHANGELOG และ README อัปเดตตรงกับโค้ด

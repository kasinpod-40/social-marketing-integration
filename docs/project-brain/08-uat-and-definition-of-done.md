# 08 — UAT and Definition of Done

## Definition of Done
A task is not done unless:
- Implementation is complete for the agreed scope.
- Tests or regression checks pass.
- Critical edge cases are covered.
- Sync log and error handling are considered.
- Project Brain is updated.
- Metric definitions are not ambiguous.

## Reporting DoD
- Raw data exists or has documented limitations.
- Snapshot exists for time-changing metrics.
- Dashboard metric definitions are documented.
- Missing metrics show null/N/A instead of zero.

## Native Integration POC DoD
- Exact fields captured.
- Sync behavior documented.
- Historical range documented.
- Multi-account behavior documented.
- Upsert/duplicate behavior documented.
- Limitations recorded in Project Brain.

## Large-account DoD

- ใช้ fixture เท่าหรือมากกว่าปริมาณลูกค้าจริง
- Full traversal จบทุกหน้า และ retry ต่อจาก persisted page/chunk
- Incremental Content และ complete Analytics/reconciliation scope แยกกันชัดเจน
- Completeness expected/query counts ตรงกัน; scope ขาดต้อง fail/partial พร้อม operational evidence
- Rerun ไม่เพิ่ม Stable-key rows
- Memory/API work ถูกแบ่งเป็น bounded units และ safety limit ไม่ truncate แบบ silent success

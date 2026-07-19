# Social Marketing Integration v0.11.0 — Corrective Source Candidate

ชุด Source นี้ต่อจาก commit `2ef5618` และปิดช่องว่าง Outbox/Redrive/Migration transition ของ YouTube large-account resumable sync

## เริ่มตรวจ Source

อ่านตามลำดับ:

```text
AGENTS.md
→ docs/current-task.md
→ PROJECT_BRAIN.md
→ docs/project-brain/10-next-actions.md
→ docs/youtube-resumable-migration-runbook.md
```

รัน Gate:

```bash
npm ci
npm run check
npm test
npm run test:worker
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
```

ผลล่าสุดอยู่ใน `RELEASE_TEST_REPORT.md`

## สถานะจริง

- Official foundation: `v0.10.2-multi-channel-foundation-approved`
- Active DEV deployment เดิม: commit `44377ce`, migration 0004, Worker `2037232c-152a-4e26-95fa-fca044f65bd9`
- Corrective Source candidate: ยังไม่ Push, Apply Remote migration 0005 หรือ Deploy
- Code X follow-up Secret matcher, Source hygiene และ recursive-redrive pre-mutation guard แก้แล้ว; ผล Gate อยู่ใน `RELEASE_TEST_REPORT.md`
- YouTube DEV schedule ยังทำงานจาก Deployment เดิม; ก่อน Migration ต้อง Quiesce ตาม Runbook
- Customer-owned 837-video Live UAT ยังไม่รันและเป็น Production blocker
- Production: ปิด

## สิ่งที่แก้ในชุดนี้

- Pending warning ถูก drain ข้าม Generation และ Completed retry replay ได้แม้มี Fence ใหม่
- Permanent ทุกเส้นทางมี Dead-letter replay payload ที่รักษา Queue scope แต่ตัด Secret/Token
- Admin redrive ใช้ Generation ใหม่, Idempotent และปิดด้วย Flag เป็นค่าเริ่มต้น
- Migration 0005 Fail closed เมื่อยังมี Work/Active lock และ Bootstrap fence จาก Business checkpoint
- Superseded run เป็น `skipped`; Dry-run ไม่สร้าง Business alert

## ข้อห้าม

- ห้าม Commit `.dev.vars`, `wrangler.sync.jsonc`, Secret, Live IDs, DB runtime หรือ output artifacts
- ห้าม Apply migration 0005 ขณะ Queue/Lock/Work ยังไม่ว่าง
- ห้ามเปิด `MKT_DLQ_REDRIVE_ENABLED` ค้างไว้
- ห้ามตีความ fixture 837 หรือ DEV 2-video smoke ว่าเป็น Customer Live UAT

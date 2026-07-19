# Social Marketing Integration v0.11.0

ชุด Source ปัจจุบันเพิ่ม YouTube large-account reliability hardening หลัง Independent review

## เริ่มใช้งาน

1. อ่าน `AGENTS.md`, `docs/current-task.md`, `PROJECT_BRAIN.md` และ `docs/project-brain/10-next-actions.md`
2. ติดตั้งและตรวจ Source:

```bash
npm ci
npm run check
npm test
npm run test:worker
npm run test:report-reliability
npm audit --offline
npm run deploy:dry-run
```

3. ตรวจ Migration `0005_resumable_sync_reliability.sql` ใน DEV ก่อน Deploy
4. ใช้ `GIT_HANDOFF.md` สำหรับ Commit/Push และ `RELEASE_TEST_REPORT.md` สำหรับหลักฐาน Gate

## สถานะจริง

- Official foundation: `v0.10.2-multi-channel-foundation-approved`
- DEV deployment ปัจจุบัน: commit `44377ce`, migration 0004, Worker `2037232c-152a-4e26-95fa-fca044f65bd9`
- Source patch ใหม่นี้: Source และ clean-archive gates ผ่าน; ยังไม่ Apply migration 0005 หรือ Deploy
- YouTube DEV schedule: เปิดอยู่ใน deployment เดิม
- Customer 837-video Live UAT: ยังไม่รันและเป็น Production blocker
- Production: ปิด

## ข้อห้าม

- ห้าม Commit `.dev.vars`, `wrangler.sync.jsonc`, Secret, Live IDs หรือ local runtime files
- ห้าม Deploy/เปลี่ยน Schedule/Apply Remote migration โดยไม่มี guarded DEV review
- ห้ามตีความ 837-record fixture หรือ DEV channel 2 videos ว่าเป็น Customer Live UAT

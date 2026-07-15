# Social Marketing Integration v0.11.0-rc.1

ไฟล์ ZIP นี้เป็นชุดส่งมอบแบบแตกครั้งเดียวแล้วใช้งานต่อได้ทันที

## เริ่มใช้งาน

1. เปิดโฟลเดอร์นี้ใน Terminal หรือ VS Code
2. อ่าน `AGENTS.md`, `PROJECT_BRAIN.md` และ `docs/current-task.md`
3. รันคำสั่งตรวจ:

```bash
npm ci
npm run check
npm test
npm audit
npx wrangler deploy --dry-run --config wrangler.sync.example.jsonc
```

4. ดูคำสั่ง Git ที่พร้อมใช้ใน `GIT_HANDOFF.md`
5. ดูผลตรวจใน `RELEASE_TEST_REPORT.md`
6. ดู Blueprint ที่อนุมัติทางเทคนิคแล้วใน:
   `docs/Social_MKT_Data_Hub_Multi_Channel_Blueprint_v0.10.2.xlsx`

## สถานะ

- Official foundation: `v0.10.2-multi-channel-foundation-approved`
- Working candidate: `v0.11.0-rc.1`
- YouTube: `uat_pending`
- Schedule: disabled
- Production: not started

## สิ่งที่ห้ามทำอัตโนมัติ

- ห้าม Commit `.dev.vars` หรือ `wrangler.sync.jsonc`
- ห้ามเปิด YouTube Schedule ก่อน Live DEV UAT ผ่าน
- ห้ามใช้ Production credentials ใน DEV

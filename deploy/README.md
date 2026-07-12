# Cloudflare Sync Worker

Wrangler configuration ตัวอย่างถูกย้ายไปไว้ที่ repository root:

```text
wrangler.sync.example.jsonc
```

เหตุผลคือ Wrangler resolve `main` และ `migrations_dir` เทียบกับตำแหน่งไฟล์ config โดยตรง การวาง config ที่ root ทำให้ path ของ Worker, migrations, CI และ Vitest ใช้แหล่งเดียวกัน

## ตรวจ Package ก่อน Deploy

```bash
npm ci
npm test
npm run check
npm run deploy:dry-run
```

## เตรียม Config จริง

```bash
cp wrangler.sync.example.jsonc wrangler.sync.jsonc
```

แทนค่า `database_id`, Table IDs, profile และ queue names ให้ตรงกับ DEV/Production environment แล้วตั้ง Secret ผ่าน Wrangler:

```bash
npx wrangler secret put LARK_APP_ID --config wrangler.sync.jsonc
npx wrangler secret put LARK_APP_SECRET --config wrangler.sync.jsonc
npx wrangler secret put LARK_APP_TOKEN --config wrangler.sync.jsonc
```

ห้ามเก็บ Secret จริงใน Git

## Apply D1 migrations

ก่อน Deploy v0.6.0 ที่เปิด Incremental Sync ให้ใช้ migration command เพื่อให้ Wrangler ใช้ `d1_migrations` ติดตามเฉพาะไฟล์ที่ยังไม่ถูก Apply:

```bash
npx wrangler d1 migrations apply MKT_STATE_DB \
  --remote \
  --config wrangler.sync.jsonc
```

ต้องมีตารางใหม่:

```text
sync_cursors
source_record_states
```

จากนั้นเปิดค่า Runtime ที่ไม่เป็น Secret ใน `wrangler.sync.jsonc`:

```jsonc
"MKT_TIKTOK_INCREMENTAL_ENABLED": "true",
"MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS": "86400000"
```

รายละเอียด UAT อยู่ใน `docs/tiktok-incremental-sync-v0.6.0.md`

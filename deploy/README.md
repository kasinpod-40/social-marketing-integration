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

# YouTube Worker Dry-run Rollout Operator

## สถานะและขอบเขต

เอกสารนี้อธิบาย Repository implementation ของ guarded operator เท่านั้น การเพิ่ม operator,
tests และคำสั่ง npm ไม่ได้อนุญาตให้ Deploy Worker, อ่าน/เขียน Remote D1, เรียก YouTube/Lark,
ส่ง Queue, ทำ DLQ action หรือเปิด Schedule โดยอัตโนมัติ ทุก Remote phase ต้องได้รับอนุญาตใหม่
แยกกันและใช้ exact confirmation ของ phase นั้น

```text
contractVersion = youtube-dry-run-rollout-v1
runtime         = development / integration_workspace
customerKey     = chemistry_k
YouTube account = dev_ft_pumkin
default mode    = plan-only
```

## Stable operation identity

Operator สร้าง Job ผ่าน Shared Queue helper เท่านั้น:

```text
schemaVersion        = 1
type                 = youtube.channel.organic.sync
trigger              = youtube_worker_dry_run
dryRun               = true
analyticsEnabled     = false
operationId          = explicit safe identifier
workKey              = youtube:{operationId}
generation           = originalRequestedAt
requestedAt          = ISO(originalRequestedAt)
syncRunId            = youtube-dry-run:{operationId}
metricDate           = generation ใน Asia/Bangkok
```

Cloudflare delivery `message.id` เป็น Transport identity และห้ามใช้แทน durable Business intent.
Retry/redrive ที่มี operation เดิมต้องคง `operationId`, `workKey`, `generation` และ
`originalRequestedAt`; completed work replay ต้องไม่เรียก Provider ซ้ำ. Scheduled/legacy
YouTube jobs ที่ไม่มี trigger นี้คง behavior เดิม.

## Side-effect boundary

`dryRun` ไม่ได้หมายถึง zero-mutation. สิ่งที่อนุญาตมีเฉพาะ:

- Public YouTube Data API GET;
- Lark GET สำหรับ `TableSyncEngine` planning;
- checkpoint read;
- `sync_runs`, lock, Queue-operation attempt, resumable work/phases/units, generation fence,
  reliability mirror และ operation-scoped alert;
- Main Queue Ack/Retry ตาม Shared Queue classification.

สิ่งที่ห้าม:

- YouTube Analytics request และ OAuth refresh;
- Lark create/update;
- Organic State/Observation/Account Daily facts;
- Coverage run/entity;
- incremental checkpoint write;
- warning drain หรือ expired-work cleanup ของ Workstream อื่น;
- schedule/route/binding/Secret mutationนอก reviewed deployment;
- automatic send/resend จาก verify หรือ failure path.

Operator path สร้าง YouTube client แบบ API-key public-only จึงไม่มี owner client หรือ refresh
provider. Result ระบุ sanitized `writeOutcomes` และ `operationalMutations`.

## Config window

ไฟล์ Safe และ Dry-run ต้องเป็น reviewed config สองไฟล์ที่แตกต่างกันเฉพาะ:

```text
Safe baseline                       Dry-run window
MKT_CONNECTOR_YOUTUBE_ENABLED=false MKT_CONNECTOR_YOUTUBE_ENABLED=true
MKT_YOUTUBE_END_TO_END_ENABLED=false MKT_YOUTUBE_END_TO_END_ENABLED=true
```

Business D1/Lark, Analytics, Report, Retention, all schedules, Meta, WooCommerce, TikTok,
Google Ads และ DLQ-redrive gates ต้อง false. Operator ตรวจ Worker name, D1 binding/database,
Queue producer, Main/DLQ consumers, retry/batch settings, Cron, route/workers_dev, required
Lark mappings, exact Channel mapping, connector identity และ required Secret namesโดยไม่อ่านค่า.
ห้ามใช้ Wrangler `--var` override.

Safe/Active reviewed config ต้องรักษา:

```text
Worker       social-mkt-sync-worker
D1 binding   MKT_STATE_DB → social-mkt-state-dev
Queue        MKT_SYNC_QUEUE → social-mkt-sync-jobs
DLQ          social-mkt-sync-dlq
Main retry   batch=10, timeout=30, concurrency=1, retries=5
DLQ retry    batch=10, timeout=30, concurrency=1, retries=10
Cron         */5 * * * * ; 50 0,6,12,18 * * *
Routes       none
workers.dev  false
```

## Phases และ authorization

```text
plan
preflight
deploy-safe-baseline
verify-safe-baseline
deploy-dry-run-gates
verify-deployment
snapshot-operational-state
send-one-dry-run
verify-dry-run
restore-all-false
verify-restore
summary
```

`npm run rollout:youtube-dry-run` แสดง plan เท่านั้นและไม่รับ `--execute`. Executable phase
ต้องใช้ทั้ง `--execute` และ exact confirmation value จาก output ของ plan. สิทธิ์ของ phase หนึ่ง
ไม่ส่งต่อไป phase อื่น.

Package shortcuts:

```bash
npm run rollout:youtube-dry-run
npm run rollout:youtube-dry-run:preflight
npm run rollout:youtube-dry-run:deploy-safe
npm run rollout:youtube-dry-run:enable
npm run rollout:youtube-dry-run:snapshot
npm run rollout:youtube-dry-run:send
npm run rollout:youtube-dry-run:verify
npm run rollout:youtube-dry-run:restore
npm run rollout:youtube-dry-run:verify-restore
npm run rollout:youtube-dry-run:summary
```

Non-secret target inputs ระบุ exact repository head, active version, operation, generation,
reviewed config paths, Worker/D1/Queue names, account key และ allowlisted Channel ID. API token,
Lark credentials และ YouTube key อยู่ใน Secret store/environment เท่านั้น.

## Provenance และ evidence

Deployment commandsใช้เฉพาะ Wrangler 4.110.0 options ที่ตรวจจาก help แล้ว: `deploy`,
`--strict`, `--config`, `--message` และ local `--dry-run`. Message:

```text
youtube-dry-run-rollout-v1 phase={phase} git={FULL_SHA}
```

Evidence อยู่ที่ `outputs/youtube-dry-run-rollout/` ซึ่ง Git ignore และเขียนเป็น sanitized JSON
mode `0600`. ทุก phase ตรวจ contract version, full repository head, target fingerprint,
operation identity และ SHA-256 ของ canonical evidence ก่อนหน้า. แต่ละไฟล์มี
`priorPhase`, `priorEvidenceSha256` และ `evidenceSha256`; summary ตรวจทั้งลำดับและปฏิเสธ
tamper, skip, reorder, head/target/operation drift. Recovery chain ผูกกลับไปยัง exact
activation evidence แทนการเริ่ม chain ใหม่โดยไม่มี provenance. Evidence เก็บเฉพาะ
hash/fingerprint/counter และ IDs เชิง operational ที่จำเป็น แต่ไม่เก็บ credential,
raw Queue payload, raw Provider/Lark response หรือ customer payload.

Operator client นับเฉพาะ Public Data fetch attempts และ Reliability details บันทึก sanitized
`providerRequestCount`, `analyticsRequestCount=0`, `oauthRefreshCount=0` และ
`larkWriteCount=0`; snapshot อ่าน counters เหล่านี้จาก exact `syncRunId` แทนการเดาค่า.

Before/after SQL scope ด้วย exact `operationId`, `workKey` และ `syncRunId`; ห้ามใช้ global
count ตัดสิน. Completion ต้องเห็น `sync_runs.status=success`, `finished_at`, Work lifecycle
`completed`, `completed_at`, completion JSON, Main Queue attempt อย่างน้อยหนึ่งครั้ง,
ไม่มี active lock และไม่มี DLQ. Terminal failure/partial/skipped/superseded หยุดทันที;
สถานะ running/pending ที่ยังไม่ครบ poll ต่อแบบ bounded.

Remote verification ไม่ใช้ local config fingerprint เป็นหลักฐานแทน Remote state:

- `wrangler versions view --json` ตรวจ exact version, deployment message, bindings,
  plain flags และ Secret names เท่านั้น;
- `wrangler deployments status --json` ตรวจ single version ที่รับ traffic 100%;
- `wrangler queues consumer list --json` ตรวจ Main/DLQ consumer settings;
- Cloudflare Workers Scripts Read endpoints ตรวจ Cron schedules, route patterns และ
  `workers.dev` subdomain state.

การอ่าน trigger state ต้องมี `CLOUDFLARE_ACCOUNT_ID` และ `CLOUDFLARE_API_TOKEN` ที่มี
Workers Scripts Read; operator fail closed เมื่อ response/schema ไม่ครบ.

## One-message และ restore

`send-one-dry-run` เรียก Cloudflare Queue push endpointหนึ่งครั้งด้วย JSON message contract,
ไม่มี retry loop และสร้าง exclusive `send-one-dry-run-attempt.json` ก่อนเรียก endpoint.
Marker คงอยู่แม้ผลคำสั่งไม่แน่นอนเพื่อ block การส่งซ้ำ แล้วบันทึก
`queueSendCommandCount=1`. HTTP/API failure หยุดทันทีและห้ามส่งซ้ำ.
`verify-dry-run` มี sender count เป็นศูนย์.

`new_execution` ต้องเห็น operation-scoped durable state ว่างก่อนส่งและต้องมี Public Provider
request มากกว่าศูนย์หลังจบ. `replay_verification` ใช้ operation ที่ completed อยู่แล้ว,
ส่งซ้ำได้เฉพาะเมื่อผู้ปฏิบัติงานเลือก mode นี้ชัดเจน และต้องมี Provider request เพิ่มเป็นศูนย์.
Dry-run completion replay คง warnings/reconciliation/source summary, บังคับ
`checkpointSaved=false`, ไม่สร้าง warning outbox และไม่ drain warning.

เมื่อ phase หลัง activation ล้ม operator สร้าง `emergency-restore.json` ที่ sanitized และแสดง
guarded wrapper command `npm run rollout:youtube-dry-run:restore`. Wrapper อ่าน active version
ก่อนเสมอ: ถ้าเป็น safe baseline คืน `RESTORE_NOT_REQUIRED`; ถ้าเป็น exact dry-run version
ที่พิสูจน์จาก activation evidence หรือ exact deployment message/SHA/phase จึงอนุญาต deploy
Safe config; version อื่นคืน `BLOCKED_ACTIVE_VERSION_CHANGED`. ห้าม emergency artifact
บรรจุ blind `wrangler deploy`. จากนั้น `verify-restore` ต้องตรวจ active traffic 100% และ
Remote fingerprints.

## Repository verification

Repository implementation นี้ตรวจด้วย Node fixtures และ Workers runtime test ที่ใช้ D1
จริงใน Miniflare; mock เฉพาะ external YouTube/Lark transports:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
```

ไม่มี Remote phase ใดถูกเรียกใน implementation/verification นี้.

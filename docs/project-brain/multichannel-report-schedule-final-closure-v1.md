# Multichannel Report & Schedule Final Closure v1

## Decision

Shared Report coverage is closed for Facebook, Instagram, TikTok, YouTube, Meta Ads, Google Ads,
WooCommerce and Chatwoot at `1D/3D/7D/30D`. TikTok Ads remains planned. The runtime must derive
scheduled Report platforms from the reviewed adapter registry instead of maintaining another
channel list or channel-specific report generator.

Retained Source/Report UAT allows Meta Ads, Google Ads and Chatwoot to move from `uat_pending` to
`active`. `active` never means auto-enabled: connector, write, report and schedule gates remain
explicit and default false.

## Runtime topology

The Cloudflare primary cron remains the local orchestration boundary. It produces reference-only
Queue jobs; Provider reads and Business writes occur in existing consumers.

```text
Primary cron (*/5, UTC event)
  ├─ existing source jobs: TikTok watermark, Facebook, Instagram, WooCommerce
  ├─ Meta Ads: previous completed Bangkok day / one job per account alias
  ├─ Chatwoot: daily incremental / locked three-day overlap
  ├─ Daily Shared Report: 8 platforms × 1D/3D/7D/30D
  ├─ Weekly Shared Report: 8 platforms × 7D
  └─ reliability mirror drain

Dedicated YouTube cron
  └─ existing source/Analytics job

Google Ads Manager Script
  └─ signed ingress → reference Queue job → existing consumer
```

Google Ads deliberately has no second Cloudflare source producer. Its schedule is owned by the
Google Ads Manager Script UI; the Worker receives signed, replay-protected deliveries.

## Idempotency and partial failure

- Cron and Queue delivery are at-least-once, so every scheduled Meta Ads, Chatwoot and Report job
  carries deterministic `operationId`, `workKey`, `generation` and `originalRequestedAt`.
- Report identities include cadence, platform, window and completed period end. Business output
  retains existing stable Report keys; a retry or Daily/Weekly 7D overlap upserts instead of
  creating a second snapshot identity.
- Report fan-out uses Queue `sendBatch` for up to 33/34 messages in the current schedules, below
  the platform batch-count boundary, with the original sequential `send` path retained for mocks
  and compatibility.
- Producer gate validation happens before the first Queue mutation. A missing consumer/read/write
  gate rejects the entire cron admission rather than creating partial channel activation.

## Time and windows

All business times are interpreted by the existing timezone resolver. Cloudflare cron itself is
UTC and only wakes the producer; the producer compares current local weekday/time.

| Work | Local time |
|---|---|
| WooCommerce source | 01:30 |
| Facebook source | 07:30 |
| Instagram source | 07:35 |
| Meta Ads source | 07:40 |
| Chatwoot source | 07:45 |
| YouTube Analytics | 07:50 source timezone |
| Daily Shared Report | 08:10 Asia/Bangkok |
| Weekly Shared Report | Monday 08:15 Asia/Bangkok |

Daily Report always targets the previous completed local day and expands rolling windows
inclusively. Weekly is a reviewed 7D refresh using the same materializer, not a second report
engine.

## Data semantics

Scheduled materialization reuses the existing platform adapters, D1 sources and Lark writer.
Therefore Missing metric semantics remain `null`/N/A, observed zero remains `0`, negative
corrections are preserved, and money metrics continue to use exact numeric values plus the
existing display/currency representation. No scheduler code may fabricate metrics or replace
Shared adapter behavior.

## Activation boundary

Repository merge is not runtime activation. Integration Workspace activation requires:

1. exact merged `main` and passing post-merge CI;
2. current Cloudflare/Lark/Provider authority without exposing secrets;
3. idle Queue/DLQ/lock and no conflicting deploy/schedule;
4. source schedules enabled separately per reviewed channel;
5. Google Ads Manager Script trigger confirmed at the Provider boundary;
6. Daily/Weekly Report gates enabled only after all required sources and report readers are ready;
7. active-version and trigger readback with no duplicate schedule;
8. Production profile remains blocked.

Facebook retained R2 evidence is immutable and must never be replayed as part of activation.

## Integration Workspace LIVE activation result — 2026-08-10

Source และ Daily/Weekly Shared Report schedules เปิดบน Integration Workspace แล้ว โดย Sync Worker
active version คือ `04dc61e2-1f6a-4c79-9226-6dedbbec9593`; primary cron ยังคง
`*/5 * * * *`, YouTube wake-up cron ยังคง `50 0,6,12,18 * * *` และ Queue มี producer/consumer
ชุดเดิมเพียงชุดเดียว. Notification runtime, automatic weekly notification, DLQ redrive และ
Production ยังคงปิด.

Previous-day source catch-up สำเร็จสำหรับ TikTok, Facebook, Instagram, YouTube public,
Meta Ads, Google Ads และ WooCommerce. Instagram ต้องแก้ period propagation และ staged-unit
pagination ก่อน R3 จะจบด้วย D1/Lark reconciliation `failed=0`. Google Ads fresh LIVE run
`609cc147-809b-404a-a484-dcbb82c12a6f` รับครบ 7/7 chunks และ 1,335/1,335 rows; admission
`completed` ด้วย send attempt เดียว, reconciliation ครบ 6 datasets โดย `failed_rows=0` และ
ไม่มี DLQ/Alert ใหม่. D1/Lark parity คือ Ads entities 1,105 และ Daily facts 390. Manager Script
หลัก Enabled และ Provider UI readback ยืนยัน `Daily between 6:00 AM and 7:00 AM`; PREVIEW script
ไม่มี frequency จึงไม่มี duplicate producer. Chatwoot ยังติด mutable Provider pagination.
YouTube Analytics ถูกวินิจฉัยใหม่ว่า ingestion อ่าน legacy OAuth path แทน Customer Connection เดิม;
repository bridge แก้และผ่าน gates แล้วโดยไม่ต้องให้ลูกค้า Connect ซ้ำ แต่ยังรอ reviewed deploy,
Owner preflight และ controlled Analytics catch-up จึงยังไม่ถือว่า Live ผ่าน.

Daily materialization วันที่สิ้นสุด `2026-08-09` สำเร็จครบ 32 D1/Lark snapshot identities:
8 platforms × `1D/3D/7D/30D`. Lark readback พบ 32 snapshots, 1,236 metric rows,
80 Top Content rows และ 40 Top Ads rows โดย stable-key duplicate เป็นศูนย์. Google Ads R3
`1D/3D/7D/30D` ทั้งสี่รายการมี coverage 1 และ source watermark เป็น fresh LIVE run ข้างต้น.
Data status คงตาม Source contract: `complete=17`, `partial=3`, `revisable=12`; ไม่มีการแทน
missing metric ด้วยศูนย์. Paid Ads รอบแรก 8 jobs ที่ขาด Top Ads binding ถูกเก็บเป็น DLQ evidence;
รอบแก้ใช้ operation IDs ใหม่และไม่ redrive.

Final readback ณ `2026-08-10 15:35 Asia/Bangkok` พบ mirror outbox เฉพาะ `delivered=360`,
pending 0, Google Ads DLQ/Alert ใหม่ 0 และ active non-expired lock 0. API active version คือ
`4166852d-c8bb-438a-9ab4-ffeec9520a7f`; Sync active version ยังคง
`04dc61e2-1f6a-4c79-9226-6dedbbec9593`. Active work
ที่เหลือมีเพียง protected Meta Ads forensic history ซึ่งอยู่นอก activation scope และไม่ได้ถูกแก้ไข.

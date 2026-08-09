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

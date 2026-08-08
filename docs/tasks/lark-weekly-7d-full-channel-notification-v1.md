# Lark Weekly 7D Full-Channel Executive Notification v1

Date: 2026-08-09

## Objective

Correct the Weekly Executive group report so factual channel coverage is deterministic and always renders all nine approved business channels. Native Lark AI remains responsible only for cross-channel synthesis fields.

## Architecture

```text
accepted V9 Executive AI source (immutable)
+ exact source_report_ids_json
+ exact aligned Report Snapshots
+ Report Metric Values / Top Content / Top Ads
+ nine-channel status vector
→ deterministic executive_notification_full_channel_v1 factual payload
→ dedicated notification clone identity v2
→ renderer executive_report_notification_v3
→ Shared Queue / D1 atomic dedupe / Lark IM / Notification Log mirror
```

No new Lark table or field is required. The notification clone reuses its existing `metric_summary_json` field for the deterministic factual payload. The accepted V9 source remains unchanged.

## Fixed channel order

1. TikTok Organic
2. Facebook Organic
3. Instagram Organic
4. YouTube Organic
5. Meta Ads
6. Google Ads
7. TikTok Ads
8. WooCommerce
9. Chatwoot

Every channel must render. If no usable business fact exists for the exact weekly period, render `ยังไม่พบข้อมูลสำหรับช่วงนี้` rather than omitting the channel or fabricating zero.

## Deterministic factual sections

For each exact source Report:

- use only `metric_scope=summary` and `dimension_type=summary` metrics with `availability_status=available` and a non-null value;
- sort by reviewed Report rank and emit a bounded maximum of four metrics;
- prefer existing `display_value` for client-facing currency/display precision without changing canonical `current_value`;
- emit comparison only when the materialized metric contains a real compare/change value;
- emit at most one non-placeholder Top Content or Top Ad item;
- derive paid-ad CTR from observed clicks/impressions when both are available rather than trusting a contradictory raw ratio;
- never render internal readiness/data-status vocabulary.

The whole Lark payload must remain inside the existing 24,000-byte delivery bound.

## AI boundary

AI fields remain unchanged and appear only as synthesis:

- `insight_summary` → ภาพรวมสัปดาห์นี้
- `strengths` → สิ่งที่เด่นที่สุดประจำสัปดาห์
- `weaknesses` → สิ่งที่ต้องจับตา
- `recommendations` → สิ่งที่ควรทำสัปดาห์หน้า

AI never controls whether a channel is visible.

## Backward compatibility

- `executive_weekly_7d_notification_v1` keeps `executive_report_notification_v2` exactly for retained replay/checksum safety.
- corrected full-channel delivery uses `executive_weekly_7d_notification_v2` → `executive_report_notification_v3`.
- the already-sent v1 notification identity is never reused or mutated.

## Safety

Repository implementation/CI performs:

```text
Remote Lark mutation       0
Queue send                 0
Worker deployment          0
Provider/AI call           0
Schedule activation        0
Production                 BLOCKED
```

A separately controlled post-merge send may create one new notification clone and admit one new Queue message only after exact preview/readback proves nine rendered sections and the accepted V9 source checksum is unchanged.

`docs/current-task.md` remains untouched because the active Chatwoot workstream owns it.

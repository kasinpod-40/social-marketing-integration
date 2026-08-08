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
→ deterministic executive_notification_full_channel_v1 factual payload
→ new notification-weekly-7d:full-channel:<sha256> clone identity
→ factual sections composed into clone insight_summary
→ existing executive_weekly_7d_notification_v1 / executive_report_notification_v2 renderer
→ existing Shared Queue / D1 atomic dedupe / Lark IM / Notification Log mirror
```

No new Lark table, field, Worker data reader or notification runtime is required. The corrected clone reuses its existing `metric_summary_json` field for deterministic factual evidence and its `insight_summary` for the accepted AI overview followed by nine factual channel sections. The accepted V9 source remains unchanged.

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
- retain canonical `current_value` / `compare_value`; scale only `_micros` + `currency` values at render time;
- emit comparison only when the materialized metric contains a real compare/change value;
- emit at most one non-placeholder Top Content or Top Ad item;
- derive paid-ad CTR from observed clicks/impressions when both are available rather than trusting a contradictory raw ratio;
- never render internal readiness/data-status vocabulary.

The corrected message is preflight-bounded below the existing 24,000-byte delivery payload limit.

## Source alignment

The existing PR #538 collector remains the authority for reading exact Lark Settings, Snapshot, Metric, Top Content and Top Ads rows. The correction requires its selected aligned 7D period and sorted source Report IDs to match the accepted V9 source exactly. If a newer Report generation has appeared, the correction stops before any write/send instead of mixing fresh facts with stale AI interpretation.

## AI boundary

AI content is retained exactly:

- original `insight_summary` → ภาพรวมสัปดาห์นี้, before deterministic channel sections;
- `strengths` → สิ่งที่เด่นที่สุดประจำสัปดาห์;
- `weaknesses` → สิ่งที่ต้องจับตา;
- `recommendations` → สิ่งที่ควรทำสัปดาห์หน้า.

AI never controls whether a channel is visible.

## Backward compatibility

- the already-sent `notification-weekly-7d:<sha256>` identity and its D1 checksum are immutable;
- old `executive_weekly_7d_notification_v1` renderer semantics are unchanged;
- corrected delivery uses a new `notification-weekly-7d:full-channel:<sha256>` identity while deliberately keeping the same proven `executive_weekly_7d_notification_v1` template so the existing renderer/runtime path is reused unchanged;
- factual checksum is part of the corrected identity/dedupe authority.

## Controlled operator

`scripts/lark-weekly-7d-full-channel-notification.mjs` supports:

```text
--preview   read-only Live Lark/D1 source alignment + exact message preview
--execute   create-or-exact-skip corrected clone, Queue exactly once, verify sent/mirrored + duplicate=0
--recover   poll-only after retained Queue-attempt evidence; no resend
```

The execute path requires active reviewed Report Settings and the exact AI Automation active / Base Notification Automation inactive. It performs no Worker deployment and no Report Settings write.

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

Post-merge `--preview` remains read-only. A separately confirmed `--execute` may create one corrected notification clone and admit one new Queue message only after exact preview/readback proves nine rendered sections and accepted V9 source checksum/source Report identity remain unchanged.

`docs/current-task.md` remains untouched because the active Chatwoot workstream owns it.

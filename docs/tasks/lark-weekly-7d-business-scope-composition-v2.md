# Weekly 7D Business Scope Composition v2

## Incident

Read-only factual diagnostics on the accepted 2026-07-25..2026-07-31 Weekly 7D source proved that four Report sources were present but only Meta Ads became a business-fact channel.

Observed facts:

- Facebook Organic: `data_status=complete`, 25 Metric Value rows, all rejected because `metric_scope` was `period_delta` or `current_total`.
- Instagram Organic: `data_status=partial`, 25 Metric Value rows, same scope rejection.
- Meta Ads: 14 Metric Value rows were also rejected by scope, but five real Top Ads made the channel visible.
- WooCommerce: `data_status=revisable`, 58 Metric Value rows, all rejected by scope.
- TikTok Organic, YouTube Organic, Google Ads, TikTok Ads and Chatwoot had no aligned Report source for that retained period.

The Notification composer incorrectly treated only `metric_scope=summary` as usable business evidence even though the Central Report contract materializes 7D business facts using `period_delta` and snapshot totals using `current_total`.

## Correction

Keep the existing full-channel Notification composition and D1/Queue/Lark delivery path. Change only factual metric admission semantics:

1. Admit `period_delta`, `summary`, and `current_total` scopes.
2. Prioritize `period_delta` before `summary`, then `current_total` for the bounded four metrics per channel.
3. Continue requiring `dimension_type=summary`.
4. Continue requiring `availability_status=available` and finite `current_value`.
5. Explicitly exclude `:dimension:` metric identities from channel summary facts.
6. Keep Top Content/Top Ads placeholder rejection and derived CTR behavior unchanged.
7. Bump the factual evidence shape to `executive_notification_full_channel_v2` so the corrected factual checksum/identity cannot be confused with the pre-fix preview.

## Safety

Repository-only change. No Lark write, Queue admission, message send, Worker deploy, Report Settings mutation, Automation activation or Schedule activation.

The already accepted V9 AI source remains immutable. Automatic notification remains unapproved. Production remains blocked.

## Acceptance

- Facebook/Instagram period metrics become business facts.
- WooCommerce aggregate period metrics become business facts.
- WooCommerce product/payment/shipping dimension-ranked rows remain excluded from summary facts.
- Currency micros are scaled only for presentation; canonical values remain unchanged.
- All nine channel headings remain deterministic.
- Missing aligned source channels still render explicitly as unavailable for the retained period.
- Existing full-channel notification identity/dedupe and message acceptance tests remain green.

# Dashboard Client Handoff Closure v1

## Decision

Client handoff is one closure task, not a sequence of unrelated manual fixes.

The Dashboard consumes validated Report rows. Canonical `current_value` remains source-of-truth numeric data. A new additive `display_value` field is the presentation boundary for Lark Dashboard values:

- currency metrics stored as `*_micros` are divided by `1,000,000` only in `display_value`;
- all other numeric metrics preserve their numeric meaning at four-decimal display precision;
- null remains null;
- canonical `current_value` is never rewritten by display repair.

## Executive decision

- Headline Organic card is `Organic Total Views` and binds available `current_total` `:latest_total_views` summary rows.
- Strict `period_views` remains the rolling-period metric. If historical baseline is incomplete, it stays N/A/null and the client surface must hide or label the unavailable block rather than show zero.
- Money cards/charts use `display_value`.
- `New Leads`, `Average Order Value`, and `New Customers` are not fabricated. Until their business contracts exist, client blocks are hidden.
- Unverified all-history System Alert totals do not belong on the client Executive surface; keep alerts on the Operations dashboard unless a current/client-safe filter is proven.

## Permanent implementation

- `packages/application/src/reports/report-metric-display-value.js`
- `packages/application/src/reports/build-report-output-rows.js`
- `packages/application/src/use-cases/write-dashboard-materialization-to-lark.js`
- Report materialization schema v6 with additive `display_value`
- `scripts/report-metric-display-value-backfill.mjs`

Existing materialized Report values do not need Report regeneration for the display-unit repair. After schema apply, the guarded Record-only backfill derives `display_value` from existing canonical Metric rows, fingerprints all non-display fields, and requires convergence with zero Record create/delete and zero `current_value` mutation.

## Client-ready gate

Client handoff requires:

1. exact verified PR merged to current `main`;
2. additive schema v6 apply;
3. `display_value` backfill converged;
4. all visible Dashboard blocks bound according to `docs/tasks/lark-dashboard-multichannel-compatibility-v2.md`;
5. unavailable/nonexistent business metrics hidden rather than rendered as zero;
6. fresh Base export and static Dashboard audit pass.

No Provider, Queue, D1, Worker, Schedule or Production action is part of this display closure.

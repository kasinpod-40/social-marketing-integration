# Facebook ContentDaily Live Source Repair — 2026-08-11

## Incident

Facebook inventory existed in `MKT_Content`, but `MKT_Content_Daily` had no Facebook rows and the
Organic Dashboard rendered zero. PR #623 repaired read-only recovery evaluation; its final merged
readback correctly refused closure because the retained source had 89 content rows, zero daily rows
and no target-day account fact.

## Confirmed root cause

The active Facebook credential grants `pages_show_list` and `pages_read_engagement`, but not
`read_insights`. Identity and Post-field readiness are valid with the first two permissions, but
Insights-only metrics are unavailable. Ten bounded Post identities returned zero Insight rows for
every accepted Graph-v25 query variant.

The same Page token returned the Post `shares.count` field successfully. This is source evidence,
not an inferred zero. A GET-only in-memory preview over the existing 90-day Dashboard inventory
returned 89 Posts, 64 explicit shares counts and 2,351 total shares.

## Repair contract

- Keep `read_insights` as an optional enhancement so missing Insights scope does not block explicit
  Post-field ingestion.
- Add only the accepted `shares` field to the existing bounded Post inventory query.
- Convert an explicit `shares.count` into the existing `shares_count/lifetime` Raw metric; an absent
  field remains missing and does not become zero.
- Prefer an explicit Provider insight metric if one is ever returned for the same metric name.
- Attribute cumulative fallback snapshots to the requested operation date and retain actual fetch
  time separately.
- Reuse the existing Raw, Canonical, D1 history, Coverage and Lark write engines.
- Never replay/redrive `facebook-dashboard-repair-20260809-v1`; Live validation uses a fresh ID.

## Live closeout gates

1. Merge exact-head CI-passing hotfix.
2. Deploy merged `main` with current Integration Workspace flags unchanged and DLQ redrive off.
3. Send exactly one fresh Facebook daily operation for `2026-08-10`.
4. Require terminal Work success, positive ContentDaily D1/Lark rows, exact Coverage and no alerts.
5. Materialize Facebook `1D/3D/7D/30D` current slots using fresh operation IDs.
6. Read back D1 and Lark values and verify the existing Dashboard filters without changing Dashboard
   configuration.
7. Keep Production and Notification runtime blocked.

## Live correction after r1

The first fresh operation completed with 64 observations and 2,351 shares, no DLQ and no open
alert. Durable D1 readback exposed a second regression: the shared Organic History Writer derived
`metric_date` and Coverage period from execution `observedAt` (`2026-08-11`) even though the Meta
write-set and canonical Lark row were bound to requested date `2026-08-10`. The correction keeps the
Writer default unchanged, accepts an explicit historical `metricDate`, and records an unchanged
historical snapshot as a `checkpoint`. A fresh r2 must prove D1/Lark date parity before any Dashboard
materialization; r1 remains immutable.

## Live closeout

PR #629 and PR #632 merged after exact-head Branch/Meta CI passed. Merged Worker version
`5ede6471-b890-4459-a090-e9f8c3d2ca5d` was deployed at 100% traffic with current Integration
Workspace flags preserved and DLQ redrive disabled. The active ignored deploy profile had drifted
from the checked-in Sync Worker example by omitting `nodejs_compat`; the exact deploy config restored
that already-declared compatibility flag without changing the user's local profile.

Fresh operation `facebook-contentdaily-20260810-r2` was admitted once and completed after 98 bounded
Queue attempts. Durable D1 and GET-only Lark OpenAPI readback agree on 64 distinct ContentDaily keys,
`metric_date=2026-08-10`, 2,352 total shares and zero null-share rows. Content Coverage is complete
64/64 with failed rows 0; DLQ rows and open alerts are both 0. The one-share increase from the earlier
2,351 preview is a newly observed Provider value, not a correction or fabricated delta.

Fresh Dashboard operations materialized 1D/3D/7D/30D once each. D1 and Lark metric rows expose
`facebook:latest_total_shares=2352`, display value 2,352 and availability `available` for every
window. The user visually confirmed Facebook is shown on the existing Dashboard. Views, Likes and
Comments remain null/N/A: App-level `read_insights` is ready for testing, but the active runtime
token's live `/me/permissions` grant does not include it and Graph rejects the related reads.

The retained recovery identity and r1 remain immutable; neither was replayed or redriven.

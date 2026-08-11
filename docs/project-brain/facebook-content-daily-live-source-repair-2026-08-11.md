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

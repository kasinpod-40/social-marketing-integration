# Facebook Reactions/Comments Live Completion — 2026-08-12

## Objective

Populate Facebook Likes/Reactions and Comments in the existing `MKT_Content_Daily` and Organic
Dashboard paths without adding a table, inventing zero, replaying retained work or reading user/comment
content.

## Confirmed Provider evidence

The bounded GET-only probe uses the active local credential boundary and persists no token or customer
identity. The current grant contains `read_insights`, `pages_show_list` and
`pages_read_engagement`, but not `pages_read_user_content`.

```text
shares.count                         PASS
reactions.limit(0).summary(true)     FAIL_GRAPH_10_PERMISSION
comments.limit(0).summary(true)      FAIL_GRAPH_10_PERMISSION
```

This minimal reproduction confirms the remaining blocker is the active token grant. It is not a Lark
field, Dashboard filter, D1 schema or mapping defect.

### Superseding Business-ingestion evidence — 2026-08-15

The credential conclusion above was superseded by the active Page-token ingestion path. Fresh scheduled
operation `facebook-scheduled-20260814` completed a 91/91 full inventory and returned real Views,
Reactions/Likes, Comments and Shares. D1 and GET-only Lark readback match exactly across all 91 stable keys:
Views 1,584,330; Likes 16,069; Comments 70; Shares 2,439 across 63 observed Share rows. Exact new alerts and
DLQ entries are zero. No further token rotation is required for this Integration Workspace closeout.

The remaining Dashboard N/A was a separate reader regression: three older Facebook identities outside the
latest authoritative inventory were still selected by the historical latest-observation query. Their null
Likes/Comments caused the intentionally strict aggregate to remain null. The correction scopes report rows
to an exact Coverage entity set only when Coverage is complete, full-inventory, same-period, failed-zero and
count-consistent. If any proof is missing, the reader keeps the existing strict null behavior.

## Source and metric contract

- Add the two summary-only field expansions to the existing bounded Facebook Post inventory request.
- `limit(0)` intentionally prevents reaction-user rows and Comment bodies from entering the source
  response.
- Map `reactions.summary.total_count` to Raw `reactions_count` and the existing Canonical/D1/Lark Likes
  field.
- Map `comments.summary.total_count` to Raw `comments_count` and the existing Canonical/D1/Lark Comments
  field.
- Preserve existing `shares.count → shares_count` behavior.
- An observed non-negative integer, including `0`, is real. A missing field stays null/N/A. A present but
  malformed count fails closed.
- Existing Provider insight metrics remain authoritative if Meta later returns the same canonical metric;
  the Post summary is the bounded resource fallback.

## Permission and deployment gate

The complete Facebook readiness contract is:

```text
pages_show_list
pages_read_engagement
pages_read_user_content
read_insights
```

Do not deploy the summary fields while the active Page credential lacks
`pages_read_user_content`, because scheduled Facebook inventory would fail permanently at Graph before
Business writes. The User token used for discovery and the derived Page token used for ingestion must be
rotated/uploaded from the same complete grant and verified without printing secrets.

## Live completion sequence

1. Pass repository gates and exact-head CI; merge the reviewed PR.
2. Verify the active User/Page credentials contain all four permissions with bounded GET-only calls.
3. Deploy merged `main` with existing Integration Workspace schedules and DLQ redrive state unchanged.
4. Admit one fresh Facebook daily operation identity; never reuse the retained `r1`/`r2` identities.
5. Require terminal success, complete ContentDaily Coverage, zero failed rows, zero new exact alerts and
   zero DLQ.
6. Reconcile non-null Likes/Comments source counts against D1 and GET-only Lark readback using stable keys.
7. Materialize fresh Facebook `1D/3D/7D/30D` slots and verify D1/Lark Dashboard metric parity.
8. Keep Production blocked until the wider production-readiness checklist is complete.

## Repository state

```text
IMPLEMENTATION                       COMPLETE_PREDEPLOY
FOCUSED_META_FACEBOOK                PASS_416_OF_416
FULL_UNIT                            PASS_3009_OF_3009
WORKERS_RUNTIME                      PASS_18_OF_18
REPORT_RELIABILITY                   PASS_105_OF_105
ARCHITECTURE_HYGIENE                 PASS
DEPENDENCY_AUDIT                     PASS_0_VULNERABILITIES
DEPLOY_DRY_RUN                       PASS
ACTIVE_PAGE_TOKEN_CAPABILITY         PROVEN_BY_FRESH_91_OF_91_INGESTION
LIVE_SOURCE_RECONCILIATION           PASS_D1_LARK_EXACT
LIVE_DASHBOARD_RECONCILIATION        PENDING_READER_FIX_DEPLOY
OLD_OPERATION_REPLAY                 PROHIBITED_NOT_RUN
DLQ_REDRIVE                          PROHIBITED_NOT_RUN
PRODUCTION                           BLOCKED
```

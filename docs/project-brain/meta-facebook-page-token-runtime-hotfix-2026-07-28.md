# Meta Facebook Page-token Runtime Hotfix — 2026-07-28

## Verified live incident

The guarded Facebook D1-only operation reached `facebook.content.inventory` and Meta rejected the
request before any Business or Coverage write:

```text
HTTP status                 400
Graph code                  190
Graph subcode               2069032
sync status                 failed / META_PERMANENT_API_ERROR
D1 Business rows            0
Coverage rows               0
Lark phases                 0
Queue operation identities  1
Worker restore              all-false / verified / traffic 100%
```

No Token or Secret value was persisted in evidence or output.

## Proven repository defect

The reviewed business-ingestion contract already requires
`META_FACEBOOK_PAGE_ACCESS_TOKEN` for Facebook Page reads, but the runtime factory created the
Facebook Organic source adapter from `META_ACCESS_TOKEN`, which is the discovery/User credential.
The rollout preflight also required only the discovery secret name. As a result, the accepted
read-only identity validation could pass while the live Page posts endpoint rejected the business
read credential type.

## Hotfix contract

- load `META_FACEBOOK_PAGE_ACCESS_TOKEN` as a separate secret;
- keep `META_ACCESS_TOKEN` for Facebook discovery and Meta Ads;
- create the Facebook Organic source adapter only from the Page-token client;
- keep Facebook business reads fail-closed when the Page secret is absent;
- require the Page secret name in Facebook D1 and Lark rollout preflights;
- preserve GET-only adapters, all existing mappings, stable operation identity, D1/Lark ordering,
  Queue topology, schedules and Production blocks.

The secret value must be derived and activated only through the separately authorized memory-only
operator flow. It must never be written to `.dev.vars`, source, evidence, command arguments or
logs.

## Period and Insights pagination follow-up

After the Page-token version was activated without code/settings/binding/flag drift, a fresh
Facebook D1-only operation passed the Provider credential boundary but exposed two related source
scope defects:

```text
reviewed period                         2026-07-01 through 2026-07-27
unscoped content rows staged            2,501
unscoped bounded source units           26
requested-period content rows           25
requested-period content pages          1
final source error                      META_CURSOR_MISSING
error operation                         facebook.account.insights
D1 Business/Coverage rows               0
Lark phases                             0
Worker restore                          all-false / verified / traffic 100%
```

The Facebook posts request did not receive the reviewed `since`/`until` period. The account
Insights response for that exact period contained no data and returned `paging.next/previous`
time-window links without cursor objects. That dataset is declared `paginated=false`; treating its
time-window links as cursor pagination therefore contradicted the dataset contract.

The follow-up hotfix:

- forwards the reviewed period only to Facebook content inventory;
- keeps Instagram inventory behavior unchanged;
- reads Facebook metric datasets declared `paginated=false` as a single requested-period response;
- continues to enforce opaque cursor presence/repetition guards for cursor-paginated datasets;
- preserves GET-only transport, stable operation identity, Queue topology and all default-false
  execution/schedule flags.

## Content Insights capability follow-up

The next fresh operation passed period scoping and non-cursor account Insights, then failed
safe-closed on the first content Insights request with Graph code `100`. A memory-only GET
capability probe tested every approved candidate both with and without the period:

```text
post_media_view                    HTTP 200
post_total_media_view_unique       HTTP 200
reactions_count                    HTTP 400 / Graph 100
comments_count                     HTTP 400 / Graph 100
shares_count                       HTTP 400 / Graph 100
supported pair combined            HTTP 200
```

The contract now requests only the two Live-accepted metrics. Reactions, comments and shares remain
`null` unless a separately reviewed source contract supplies them; the runtime must not fabricate
zero or relabel unsupported metrics.

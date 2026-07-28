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

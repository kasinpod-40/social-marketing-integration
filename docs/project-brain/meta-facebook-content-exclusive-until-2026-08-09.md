# Meta Facebook Content Exclusive-Until Hotfix — 2026-08-09

## Live incident

The first controlled Facebook Organic daily D1-only operation for the completed day `2026-08-08`
reached `facebook.content.inventory` and failed before any Business or Coverage write:

```text
operation_id                  meta-facebook-daily-20260808
sync status                   failed / META_PERMANENT_API_ERROR
Provider HTTP                 400
Graph code                    100
records written               0
Coverage runs                 0
Lark writes                   0
Worker restore                all-false / verified
```

The failed operation remains retained evidence and must not be blindly resent. Instagram was not
started.

## Proven root cause

The repository models report periods as inclusive date ranges. `FacebookOrganicSourceAdapter`
forwarded the inclusive `since` and `until` values unchanged to `/{page_id}/posts`.

A memory-only GET probe against the approved Page identity and Page credential proved:

```text
minimal_no_range              HTTP 200
minimal 2026-08-08..08        HTTP 400 / Graph 100 / since should be less than until
minimal 2026-08-08..09        HTTP 200
full_fields_no_range          HTTP 200
full_fields 2026-08-08..08    HTTP 400 / Graph 100 / since should be less than until
full_fields 2026-08-08..09    HTTP 200
```

Therefore Token type and approved content fields are not the failing boundary. Facebook content
inventory requires an exclusive upper date boundary while the MKT period contract remains
inclusive.

## Repository correction

Only Facebook content inventory translates the internal inclusive range to the Provider range:

```text
internal                      2026-08-08 through 2026-08-08 inclusive
Facebook posts query          since=2026-08-08 until=2026-08-09
```

For a multi-day inclusive period, the Provider `until` is likewise the day after the internal
`until`. Facebook content/account Insights keep their existing date semantics. Instagram and Meta
Ads are unchanged.

Focused regression covers both a multi-day period and the one-day incident case.

## Safety

This repository hotfix does not authorize or perform Worker deployment, Queue send, D1/Lark write,
Schedule activation, Secret mutation or Production action. Any live continuation must first use a
fresh reviewed Worker baseline and an operator-supported recovery/operation boundary. The retained
failed operation has zero operation-scoped Business rows and must remain auditable.

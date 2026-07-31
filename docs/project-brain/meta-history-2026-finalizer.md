# Project Brain — Meta History 2026 Finalizer

## Decision

The existing pinned Meta delivery remains authoritative. Facebook is verified and reused without Provider
replay. Supplemental history uses new deterministic operations only for Instagram and Meta Ads.

## History scope

```text
Instagram          2026-07-01..2026-07-31
Meta Ads required  2026-05-01..2026-07-31
Meta Ads optional  2026-01-01..2026-04-30 under bounded baseline volume
```

## Durable source behavior

- Instagram media pagination remains newest-first and stops after crossing the lower date boundary.
- Meta Ads long ranges use an internal compound cursor while every Provider request remains at most 31
  inclusive days.
- Existing <=31-day Ads and unbounded Instagram source calls keep their prior contracts.

## Execution ownership

One public launcher owns exact-main gates, pinned-session resume, fresh identity proof, operation identity,
D1/Lark chains, adaptive expansion, checkpoint reuse and automatic all-false restore.

It reuses the existing phase operators and compatibility shim. No second Connector, Queue, Reliability,
D1 writer, Coverage engine or Lark sync engine is introduced.

## Final safe decision

```text
META_HISTORY_2026_COMPLETED_SAFE
D1/Lark parity                 pass
same-operation replay          pass
Worker flags                   all false
Active Work/Lock/Queue         0/0/0
Schedule                       disabled
Production                     blocked
```

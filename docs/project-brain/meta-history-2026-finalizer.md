# Project Brain — Meta History 2026 Finalizer

## Decision

The existing pinned Meta delivery remains authoritative. Its completed Facebook operation is verified and
never replayed or replaced. A separate deterministic Facebook July operation fills missing monthly history
through the existing Shared pipeline and Stable Business keys.

## History scope

```text
Facebook pinned    verify existing completion; no replay
Facebook July      2026-07-01..2026-07-31 supplemental operation
Instagram          2026-07-01..2026-07-31
Meta Ads required  2026-05-01..2026-07-31
Meta Ads optional  2026-01-01..2026-04-30 under bounded baseline volume
```

## Durable source behavior

- Facebook supplemental history uses existing bounded `since`/`until` reads and a new deterministic
  operation identity. Stable content keys make D1/Lark writes idempotent without deleting or replacing
  existing facts.
- Instagram media pagination remains newest-first and stops after crossing the lower date boundary.
- Meta Ads long ranges use an internal compound cursor while every Provider request remains at most 31
  inclusive days.
- Existing <=31-day Ads and unbounded Instagram source calls keep their prior contracts.

## Execution ownership

One public Terminal entrypoint owns exact-main gates, six ISO generation values, pinned-session resume,
fresh identity proof, D1/Lark chains, adaptive expansion, checkpoint reuse and automatic all-false
restore.

It reuses existing phase operators and compatibility shims. No second Connector, Queue, Reliability,
D1 writer, Coverage engine or Lark sync engine is introduced.

## Final safe decision

```text
META_HISTORY_2026_COMPLETED_SAFE
Facebook pinned completion       verified / no replay
Facebook July supplemental       complete
Instagram July                   complete
Meta Ads required                complete
D1/Lark parity                   pass
same-operation replay            pass
Worker flags                     all false
Active Work/Lock/Queue           0/0/0
Schedule                         disabled
Production                       blocked
```

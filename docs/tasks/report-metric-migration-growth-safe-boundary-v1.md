# Report Metric Migration Growth-Safe Boundary v1

## Incident

After PR #523 merged, the new exact-main Report Runtime Finalizer stopped at the Report Metric field migration preview:

```text
recordCount             642
maxRecords              500
migrationCount          0
pendingMigrationCount   0
```

No Remote mutation occurred. The failure was caused by a local safety guard, not bad customer data and not an actual migration requirement.

## Decision

Total table size is not a valid migration admission boundary. Report Metric rows are expected to grow as channels, windows, dimensions and customers accumulate history.

The migration keeps its lossless field/value contract but changes the safety boundary:

```text
read/verify scope       complete paginated table
business row ceiling   none
write request ceiling  bounded batch only
legacy value deletion  forbidden
source fingerprint      required
record-count drift      fail closed during migration
```

## Runtime behavior

When fields are already converged, any table size supported by the underlying Lark reader can pass preview without a size blocker.

When a real backfill is pending, the existing migration processes only the pending canonical writes in bounded batches. After every batch it re-reads state and verifies exact progress plus unchanged source identity before continuing.

This removes artificial customer-growth failures without weakening mutation safety.

## Regression

- 2,501 converged records: preview passes with zero blocker and zero pending migration.
- 1,201 pending canonical writes: apply uses three batches `500 / 500 / 201`, preserves legacy values and converges.
- existing conflict, partial-resume, ownership and safe-evidence tests remain required.

## Operational boundary

This Repository change does not authorize Finalizer rerun, Chatwoot continuation, Queue send, Worker deployment or any Remote D1/Lark mutation. Live execution resumes only after merge on a new exact-main evidence root.

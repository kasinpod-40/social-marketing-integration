# Report Schema Conflict Recovery v1

## Incident

The confirmed Organic Dashboard 3D/7D refresh plus 1D/30D creation command reached the Report finalizer and stopped at the read-only Lark schema preview:

```text
readyToApply=false
conflictCount=2
REPORT_RUNTIME_FINALIZE_SCHEMA_PREVIEW_UNSAFE
```

The command stopped before schema apply, Worker deployment, Queue send, Remote D1 mutation, Report materialization, or Lark Record write. No partial Report operation exists from this failed attempt.

## Root cause in the operator

The Finalizer reduced every schema conflict to a count. It neither preserved safe conflict identity nor had a bounded recovery contract, so an already-confirmed one-command workflow could only stop and require another manual diagnostic round.

A separate post-Commerce gap also existed: WooCommerce was registered in canonical Report Settings but was absent from the Lark Report platform option extension.

The exact two Live conflict codes remain unconfirmed until the merged operator runs its fresh preview. This implementation does not guess their identity.

## Recovery contract

The Finalizer now runs this sequence when the first schema preview contains conflicts:

```text
fresh schema preview
→ safe conflict recovery preview
→ require every conflict to be repairable
→ guarded repair apply
→ fresh schema preview with zero conflicts
→ normal additive Report schema apply
→ Dashboard settings reconciliation
→ clean schema/settings read-back
```

Only two conflict shapes can be repaired automatically:

1. `FIELD_TYPE_MISMATCH`
   - the Field is non-primary;
   - exactly one live Field has that name;
   - every existing Record has the Field absent, null, or empty string/array;
   - observed `0` and `false` are Business values and block mutation;
   - the Field ID is retained and updated to the approved schema contract.

2. `DUPLICATE_FIELD_NAME`
   - the entire affected Table has zero Records;
   - one duplicate already has the approved type;
   - no duplicate is Primary;
   - excess empty Fields are renamed to deterministic archived names;
   - no Field or Record is deleted.

Ambiguous tables, stale configured identity, populated mismatched Fields, populated duplicate Tables, Primary Fields, races, or unsupported conflict codes remain fail-closed with sanitized `code/tableKey/fieldName/type/count` evidence.

## Commerce alignment

`woocommerce` is added to Report Settings, Snapshot, and Metric platform options. Organic Top Content remains explicitly limited to Facebook, Instagram, TikTok, and YouTube; Paid Ads remains limited to Meta Ads, Google Ads, and TikTok Ads.

## Safety

- no Record value conversion;
- no Business fact deletion;
- no Table or Field deletion;
- no Remote D1 mutation;
- no Worker deployment;
- no Queue/DLQ message;
- no Provider request;
- no Schedule or AI activation;
- Production blocked.

Repository implementation and CI perform zero Remote actions. Live repair remains inside the existing exact Report Finalizer confirmation after merge.

## Required verification

- behavioral type-mismatch recovery tests;
- zero/false Business-value blocking tests;
- real duplicate-field planning/apply tests;
- unsupported/race fail-closed tests;
- Report Finalizer ordering and evidence tests;
- WooCommerce option-scope regression;
- full repository gates and exact-head Branch Verification.

# Report Materialization Raw Checksum Hotfix v1

## Status

```text
TASK_STATUS       = IMPLEMENTED_FOR_CI
BASE_MAIN         = 51ad9ef696a14ba75d4858e67fa9b168b043c56d
BRANCH            = hotfix/report-materialization-raw-checksum-v1
REMOTE_ACTIONS    = 0
D1_MUTATION       = 0
LARK_MUTATION     = 0
```

## Incident

Read-only Lark shared-dimensions backfill Preview stopped on an unchanged historical materialization with:

```text
REPORT_MATERIALIZATION_CHECKSUM_MISMATCH
```

The stored payload predates the additive `collections` field. Its checksum was created from the exact validated payload written at that time. The current reader parsed the stored JSON through the latest schema first, which added `collections: {}` before hashing and therefore produced a different checksum.

## Correction

`D1ReportMaterializationReader` now performs the gates in this order:

1. validate the exact D1 storage row contract;
2. parse the stored `payload_json` without adding current defaults;
3. verify `payload_checksum` against that stored JSON value;
4. parse and normalize the payload through the current schema;
5. verify row metadata parity against the normalized payload.

This preserves tamper detection while allowing additive schema defaults to evolve without invalidating historical immutable materializations.

## Regression coverage

- legacy payload without `collections` passes its original checksum and normalizes to `collections: {}`;
- an actually modified payload still fails with `REPORT_MATERIALIZATION_CHECKSUM_MISMATCH`;
- current payloads containing `collections` continue to pass.

## Safety

- no checksum bypass;
- no D1 row repair or rewrite;
- no Lark write;
- no Worker deployment;
- no Queue/DLQ message;
- no Provider call;
- no Schedule, Secret, UAT, or Production action.

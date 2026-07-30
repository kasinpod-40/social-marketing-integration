# Report Runtime Config-DLQ Payload Readback Hotfix v1

## Incident

The exact Organic TikTok 3D configuration-DLQ retry reached the completed retry state and the Worker was restored to all-false, but post-retry Lark integrity verification failed with:

```text
REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_PAYLOAD_INVALID
Report payload_json is invalid
```

The failure occurred after the retry completion assertion and before retained DLQ metadata closure or the canonical 3D summary.

## Root cause

`buildReportRuntimeConfigDlqRetryStateSql()` returned the Report ID, checksum, run counts, lock count and DLQ count, but omitted `report_materializations.payload_json`. The verifier then evaluated the absent field as an empty string and attempted `JSON.parse('')`.

This was a repository readback-shape defect. It was not payload corruption and did not indicate a failed replay.

## Correction

Add the exact materialization `payload_json` to the retry-state query used by post-retry Lark integrity verification.

## Resume behavior

A retry-send attempt already exists. The next execution therefore remains verification-only:

- no Report Active deployment;
- no Queue message;
- no first-materialization retry;
- fresh D1/Lark parity verification using the returned payload JSON;
- verified all-false Worker state;
- exact retained DLQ metadata closure;
- canonical 3D summary;
- continuation to 7D, 1D and 30D.

## Required validation

```text
focused retry payload readback regression
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
Branch Verification CI on exact PR head
```

Repository implementation and CI perform no Remote deployment, Queue/DLQ send, D1/Lark mutation, Provider request, Schedule change, Secret change or Production action.

# WooCommerce Network Cause Diagnostics Hotfix

## Live evidence

The guarded WooCommerce final rollout has now passed:

- exact Chemistry K source materialization;
- `global_fetch_strictly_public` materialization;
- WooCommerce-only active-work scoping;
- failed-work recovery;
- Safe and Manual UAT deployment verification;
- Queue propagation barrier and admission.

The full reconciliation still fails at the first read-only `system_status` request with:

```text
sync_run_status      = failed
sync_run_error_code  = WOOCOMMERCE_NETWORK_ERROR
resource             = system_status
source_rows          = 0
D1 business rows     = 0
Lark business rows   = 0
active lock          = 0
automatic safe restore = PASS
```

The same credentials and endpoints return HTTP 200 from the operator machine. The public-fetch compatibility flag did not change the Worker-only failure. Therefore the exact Worker `fetch()` exception must be persisted before another routing or origin hypothesis is accepted.

## Scope

Repository-only observability hotfix:

- persist a bounded, allowlisted description of the immediate `fetch()` exception in the existing RuntimeError details;
- include error name, message and code plus one nested cause level;
- include the configured timeout and elapsed duration;
- never include request headers, Authorization, Consumer Key, Consumer Secret, response body, stack trace or URL credentials;
- retain `WOOCOMMERCE_NETWORK_ERROR` and retryable behavior unchanged;
- retain the existing Queue, Reliability, D1 writer, Lark engine, recovery, propagation and automatic safe-restore contracts unchanged.

## Safety

- No Remote D1 query or mutation during implementation.
- No Worker deployment during implementation.
- No Queue/DLQ action during implementation.
- No Lark request or mutation during implementation.
- No Secret or Production change.
- No Business fact is changed.

## Expected persisted evidence

After a post-merge authorized Worker UAT attempt, `sync_runs.details_json` will contain only sanitized diagnostics under:

```text
$.errorDetails.networkCause.name
$.errorDetails.networkCause.message
$.errorDetails.networkCause.code
$.errorDetails.networkCause.nestedName
$.errorDetails.networkCause.nestedMessage
$.errorDetails.networkCause.nestedCode
$.errorDetails.timeoutMs
$.errorDetails.elapsedMs
```

The next routing/origin fix must be based on that exact live evidence rather than another unverified hypothesis.

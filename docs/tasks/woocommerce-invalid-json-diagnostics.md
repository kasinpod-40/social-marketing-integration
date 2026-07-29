# WooCommerce Invalid-JSON Response Diagnostics Hotfix

## Live incident — 2026-07-29

Authorized Final rollout created operation:

```text
woo-final-full-6f43ac8ee857
```

The source contract, failed-work check and 120-second Queue propagation barrier passed. The first
`system_status` Provider response then failed with:

```text
sync_run_status          failed
sync_run_error_code      WOOCOMMERCE_INVALID_JSON
work_lifecycle_status    active
active_lock_count        0
queue_operation_attempts 1
coverage_run_count       0
Commerce Business rows   0
```

Automatic all-false restore succeeded at Worker version
`40ea3319-1da5-4a90-91c1-44d2451f5efd`.

This proves the prior Cloudflare `fetch` receiver defect is no longer the immediate failure: an HTTP
response was received, but its successful body could not be parsed as JSON. Existing diagnostics
persist only `resource=system_status`, so they cannot distinguish an empty body, HTML/WAF response,
malformed JSON, compression/header mismatch or a leading BOM.

## Scope

- read a successful response body once as text;
- accept one leading UTF-8 BOM before JSON parsing;
- on invalid JSON, persist only bounded structural evidence:
  - HTTP status;
  - Content-Type, Content-Encoding and numeric Content-Length;
  - body byte length and SHA-256;
  - structural shape: empty, HTML/XML, object-like, array-like or other;
  - whether a BOM was removed;
- never persist response body, prefix, URL credentials, Authorization, cookies or unrestricted headers;
- expose the allowlisted diagnostics through the existing read-only operation inspector;
- add one exact-confirmed Provider GET-only diagnostic command for the operator workstation.

## Provider-only diagnostic command after merge

```bash
CONFIRM_WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS=RUN_WOOCOMMERCE_PROVIDER_RESPONSE_DIAGNOSTICS \
node scripts/woocommerce-provider-response-diagnostics.mjs --execute
```

This command performs exactly one GET to `system_status`. It performs no Worker deployment, Queue
message, D1/Lark mutation, Schedule action or Provider mutation. A local PASS does not by itself
prove the Worker/CDN response path; it only separates origin-wide behavior from Worker-path behavior.

## Safety boundary

```text
Repository implementation      only
Remote D1 mutation             none
Business mutation              none
Queue/DLQ message              none
Worker deployment              none
Lark request/mutation          none
Provider call during coding    none
Schedule/Secret/Production     none
```

Do not rerun Final rollout and do not automatically resend operation `woo-final-full-6f43ac8ee857`.
After this diagnostics hotfix is reviewed and merged, run the one-GET Provider probe first. Exact
stale-work recovery and any later Worker diagnostic window remain separate authorizations.

# TikTok Audit Exact-Version Invocation Hotfix

## Status

```text
TASK_STATUS                       = PASS_REPOSITORY_IMPLEMENTATION
BRANCH                            = hotfix/tiktok-audit-exact-version-invocation
CURRENT_MAIN_AT_CLOSEOUT          = 15fcf96b42825cb132d581b47d21ce1780186199
DRAFT_PR                          = #120
PRE_CLOSEOUT_BRANCH_VERIFICATION  = #702 / PASS
FINAL_BRANCH_VERIFICATION         = REQUIRED_ON_FINAL_PR_HEAD
REMOTE_ACTIONS                    = NONE
REMOTE_AUDIT_RETRY_AUTHORIZED     = false
```

## Incident evidence

A controlled Audit-only deployment produced three unauthenticated `401` responses, but the immediately following authenticated GET returned HTTP `404` with sanitized remote fallback code `TIKTOK_POST_LARK_AUDIT_FAILED`. Emergency safe-close completed with three `404` responses at Worker version `388479ba-037b-4a89-942f-dad176311f93`.

The incident proves that HTTP status alone does not bind the probe and authenticated Audit to the Wrangler deployment version. The runtime remains safe-closed; no Queue message, Admission, Business write, Lark mutation, schedule activation or Production action occurred.

## Objective

Bind every guarded TikTok route probe and the one authenticated Audit request to the exact Wrangler deployment version, and require the Worker runtime to attest the invoked version before accepting route or Audit evidence.

## In scope

- require a Cloudflare Worker Version Metadata binding in reviewed Safe and Audit configs;
- expose only the sanitized runtime Worker version ID on the guarded TikTok Audit response;
- send `Cloudflare-Workers-Version-Overrides` for every route probe and authenticated Audit request;
- validate the returned runtime version ID equals the exact Wrangler `deploy.version_id`;
- preserve cache busting, no-cache headers, redirect blocking, bounded response handling and stale-evidence guards;
- preserve emergency safe-close after any enable or Audit failure;
- add Node and Workers-runtime regression coverage;
- update runbook and durable project documentation.

## Out of scope

- Worker deployment or rollback;
- Secret rotation;
- authenticated Remote Audit retry;
- Queue/DLQ action, watermark Admission or processing;
- D1/Lark Business writes or schema changes;
- schedule activation, retention/delete or Production.

## Contracts

```text
VERSION_METADATA_BINDING          = CF_VERSION_METADATA
VERSION_RESPONSE_HEADER           = x-mkt-worker-version-id
VERSION_OVERRIDE_HEADER           = Cloudflare-Workers-Version-Overrides
WORKER_NAME                       = social-mkt-sync-worker
ROUTE_PROBE_COUNT                 = 3
SAFE_STATUS                       = 404
AUDIT_GUARD_STATUS                = 401
AUTHENTICATED_AUDIT_STATUS        = 200
```

Every guarded request must carry a version override for the exact reviewed Worker name and deployment UUID. Every response must carry the runtime version UUID from `CF_VERSION_METADATA.id`. Missing, malformed or mismatched runtime identity fails closed without recording passed evidence.

## Acceptance criteria

- Safe and Audit config validation rejects missing or renamed Version Metadata binding.
- Disabled, unauthorized, failed and successful guarded responses all contain only the runtime version header and no secret/runtime internals.
- Route probes retain exactly three consecutive expected statuses and additionally require exact runtime-version equality on every response.
- Authenticated Audit uses the passed enable deployment version, unique cache busting, no-cache headers, manual redirects, timeout and exact runtime-version validation.
- Evidence records deployment/runtime version IDs and sanitized status/timestamps only; no raw origin, URL, nonce, body, header or token.
- Queue or Business-write path additions remain zero.
- Focused tests, `npm run check`, full Unit/Workers tests, report reliability, dependency audit and Wrangler dry-run pass.

## Implementation result

```text
IMPLEMENTATION_RESULT             = PASS_TIKTOK_AUDIT_EXACT_VERSION_HOTFIX
VERSION_METADATA_CONFIG_GATE      = PASS
EXACT_VERSION_OVERRIDE            = PASS
RUNTIME_VERSION_ATTESTATION       = PASS
THREE_PROBE_STATUS_GATE           = PRESERVED
THREE_PROBE_VERSION_GATE          = PASS
AUTHENTICATED_AUDIT_PINNING       = PASS
CACHE_BUSTING_AND_NO_CACHE        = PASS
REDIRECT_AND_TIMEOUT_GUARDS       = PASS
BOUNDED_JSON_RESPONSE             = PASS
LEGACY_ENABLE_EVIDENCE_BLOCK      = PASS
EMERGENCY_SAFE_CLOSE              = PRESERVED
QUEUE_OR_WRITE_PATH_ADDED         = false
REMOTE_ACTION_COUNT               = 0
```

Implementation reuses a Shared Cloudflare Worker-version contract and the existing rollout probe/evidence chain. It does not add a second rollout engine, HTTP router, Queue path, D1 writer or Lark sync path.

Pre-closeout verification passed before the final parallel-workstream synchronization:

```text
PRE_CLOSEOUT_BRANCH_VERIFICATION  = #702 / PASS
FOCUSED_STAGED_TIKTOK             = 4 / 4 PASS
NODE_UNIT_INTEGRATION             = 1090 / 1090 PASS
WORKERS_RUNTIME                   = 12 / 12 PASS
REPORT_RELIABILITY                = 91 / 91 PASS
DEPENDENCY_AUDIT                  = 0 vulnerabilities
ARCHITECTURE_AND_HYGIENE          = PASS
WRANGLER_DRY_RUN                  = PASS / NO DEPLOYMENT
```

Integration Review may return `PASS_FOR_MERGE` only after the final PR head is confirmed current with `main` and its Branch Verification passes.

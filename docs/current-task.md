# Current Task — TikTok Post-Lark Audit Route Stability Hotfix

## Authoritative status

```text
TASK_STATUS                              = IMPLEMENTATION_PASS_DRAFT_PR_OPEN
CURRENT_PROGRAM                          = TIKTOK_POST_LARK_AUDIT_ROUTE_STABILITY_HOTFIX
BASE_MAIN_SHA                            = 1ec60980c3897f01cef9bdc5f24aa6f5b7eba295
BRANCH                                   = hotfix/tiktok-post-lark-audit-route-stability
DRAFT_PR                                 = #103
IMPLEMENTATION_COMMIT                    = 0195366e85ba288dcde9dcb496ccb66c61e78a3c
REMOTE_STATE                             = SAFE_CLOSED_404
MIGRATION_0016                           = APPLIED
MIGRATION_0017                           = APPLIED
PENDING_MIGRATIONS                       = 0
AUTHENTICATED_REQUEST_COUNT_LAST_WINDOW  = 0
ROOT_CAUSE                               = ROUTE_PROPAGATION_OR_RUNTIME_INCONSISTENCY
NEW_REMOTE_AUDIT_AUTHORIZED              = false
REMOTE_ACTION_COUNT                      = 0
```

The previous Current Task is preserved verbatim at:

```text
docs/archive/current-task-before-tiktok-post-lark-audit-route-stability-hotfix-2026-07-27.md
```

## Objective

ทำให้ทุก Worker deployment phase ของ TikTok Post-Lark rollout operator ยืนยัน route
ด้วย bounded consecutive probes และผูก evidence กับ exact deployed Worker version
ก่อนอนุญาต phase ถัดไป โดยไม่เปลี่ยน Audit Business logic หรือเพิ่ม Remote action
ในงาน Repository-only นี้

## Incident boundary

```text
ENABLE_OPERATOR_ROUTE_STATUS        = 401
EXTERNAL_POST_ENABLE_ROUTE_STATUS   = 404
PROBE_ORDER                         = AFTER_ENABLE_BEFORE_SAFE_CLOSE
ORIGIN_AND_PATH_MATCH               = true
SAFE_AUDIT_CONFIG_TARGET_MATCH      = true
UNEXPECTED_DEPLOYMENT               = false
FINAL_REMOTE_STATE                  = SAFE_CLOSED_404
```

Root cause is classified as `ROUTE_PROPAGATION_OR_RUNTIME_INCONSISTENCY`.
This task does not attribute the incident to Audit Business logic, Lark or D1.

## In scope

- Three consecutive unauthenticated route probes after `deploy-safe`, `enable-audit`
  and `disable-audit`
- Unique cache-busting query, manual redirects and no-cache request headers
- Bounded response-body discard, request timeout and inter-probe delay
- SHA-256 target fingerprint without raw origin/path persistence
- Typed Wrangler structured-output parsing for exact deployed Worker version ID
- Deployment start/completion timestamps and source in evidence
- Separate failed stability evidence that never overwrites prior passed evidence
- Fresh, complete, same-target `enable-audit` evidence required before authenticated Audit
- Emergency safe-close remains available after an enable attempt without successful Audit
- Focused, full regression and Workers-runtime verification

## Out of scope

```text
Worker deployment
Secret rotation
Audit route enablement
Authenticated Audit request
D1 or Lark mutation
Queue message or DLQ action
Watermark Admission
Business writer or Report cutover
Schedule change
Migration 0016 or 0017 change
Production
PR merge
```

## Safety and evidence contract

- Route probes run exactly three times; no unbounded retry exists.
- Probe requests never contain Authorization.
- Evidence never stores raw origin, URL, nonce, response body, headers or Token.
- Stability mismatch uses `TIKTOK_POST_LARK_ROLLOUT_ROUTE_STABILITY_FAILED`.
- Missing or malformed version identity uses
  `TIKTOK_POST_LARK_ROLLOUT_DEPLOYMENT_ID_UNAVAILABLE`.
- Stale or incomplete enable evidence uses
  `TIKTOK_POST_LARK_ROLLOUT_ENABLE_EVIDENCE_STALE`.
- `enable-audit.json` is written as passed only after all three `401` probes pass.
- Failed attempts are written separately and require safe-close.

## Required verification

```bash
npm ci
npm run check
node --test tests/application/tiktok-post-lark-rollout-operator.test.js
node --test tests/application/tiktok-post-lark-audit-http.test.js
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
git diff --check
```

## Implementation result

```text
IMPLEMENTATION_RESULT               = PASS_TIKTOK_AUDIT_ROUTE_STABILITY_HOTFIX_IMPLEMENTATION
DEPLOYMENT_VERSION_CAPTURE          = PASS
CACHE_BUSTING_PROBES                = PASS
NO_CACHE_HEADERS                    = PASS
THREE_CONSECUTIVE_401_GATE          = PASS
THREE_CONSECUTIVE_404_GATE          = PASS
STALE_EVIDENCE_BLOCK                = PASS
EVIDENCE_REDACTION                  = PASS
QUEUE_OR_WRITE_PATH_ADDED           = false
FOCUSED_NODE_TESTS                  = 30 / 30 PASS
WORKERS_RUNTIME_TESTS               = 10 / 10 PASS
NPM_CHECK                           = PASS
NPM_TEST                            = 1006 Unit + 10 Workers PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
NPM_AUDIT                           = PASS / Branch Verification #634
DEPLOY_DRY_RUN                      = PASS / no deployment
BRANCH_VERIFICATION                 = #634 / 30261994832 / PASS
REMOTE_ACTION_COUNT                 = 0
```

## Remaining gate

Draft PR review and merge remain separate. No Worker deployment, Secret rotation or new Remote
Audit window is authorized by this Repository-only task. After merge, the next controlled order is:
all-flags-false deployment, verified stable `404`, one separately approved Audit-only window,
three stable `401` probes, one authenticated read-only Audit, then immediate stable `404` safe-close.

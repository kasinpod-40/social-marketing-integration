# Current Task — TikTok Post-Lark Audit Sanitized Error Code Hotfix

## Authoritative status

```text
TASK_STATUS                         = IMPLEMENTATION_PASS_DRAFT_PR_OPEN
CURRENT_PROGRAM                     = TIKTOK_POST_LARK_AUDIT_ERROR_CODE_HOTFIX
BASE_MAIN_SHA                       = db475ebb825f8a6cb3100bb2f4be5d7a43c8613d
INCIDENT_BASELINE_HEAD              = 8b7f9a879ba0c1b0b5d89dcfa2373ad3bb3c2ce8
BRANCH                              = hotfix/tiktok-post-lark-audit-error-code
REMOTE_MIGRATION_0016               = APPLIED
REMOTE_AUDIT_ROUTE                  = SAFE_CLOSED / HTTP 404
REMOTE_TIKTOK_AUDIT_FLAG            = false
REMOTE_BUSINESS_FLAGS               = all false
REMOTE_SCHEDULE_FLAGS               = all false
AUTHENTICATED_AUDIT_HTTP_STATUS     = 400
AUTHENTICATED_AUDIT_ERROR           = TikTok audit failed
AUTHENTICATED_AUDIT_ERROR_CODE      = NULL_OR_MISSING
QUEUE_OR_BUSINESS_WRITE_PERFORMED   = false
HOTFIX_REMOTE_ACTION                = NONE
MANUAL_PROCESSING                   = BLOCKED
PRODUCTION                          = BLOCKED
```

The previous WooCommerce Integration Merge Closeout task is preserved verbatim at:

```text
docs/archive/current-task-before-tiktok-post-lark-audit-error-code-hotfix-2026-07-27.md
```

## Objective

ทำให้ authenticated TikTok Post-Lark Audit failure ทุกกรณีที่ตอบ HTTP `400` มี
sanitized, stable และ non-empty error code โดยไม่เปิดเผย raw exception, message,
stack, details, Secret, Token, Customer identity, Table ID หรือ Content ID และทำให้
Rollout Operator เก็บเฉพาะ HTTP status กับ sanitized remote code เมื่อ Remote Audit
ตอบสถานะที่ไม่ใช่ `200`

## In scope

- ใช้ `TIKTOK_POST_LARK_AUDIT_FAILED` เมื่อ HTTP boundary ได้ operational code ที่ว่าง
- รักษา known operational code เดิม รวมถึง `TIKTOK_POST_LARK_AUDIT_UNAUTHORIZED`
- เพิ่ม Operator error `TIKTOK_POST_LARK_ROLLOUT_AUDIT_HTTP_FAILED`
- จำกัด Operator error details ไว้เฉพาะ `httpStatus` และ `remoteCode`
- fallback Remote code ที่หายหรือไม่อยู่ในรูป stable code เป็น
  `TIKTOK_POST_LARK_AUDIT_FAILED`
- รักษา Audit success path และ `audit.json` evidence contract เดิม
- เพิ่ม Node และ Workers-runtime regression tests
- อัปเดต Current Task, Project Brain และ Changelog ตาม Runtime facts ที่เกิดขึ้นจริง

## Out of scope

```text
Worker deployment
Audit route enablement
Live Audit
Worker Secret rotation
D1 Migration apply
Remote D1 or Lark mutation
Queue message
DLQ action
Watermark Admission
D1 or Canonical Business write
Report cutover
Cron or Schedule activation
Production
PR merge
```

## Acceptance criteria

- Generic authenticated failure ตอบ HTTP `400` และ
  `code=TIKTOK_POST_LARK_AUDIT_FAILED`
- Known error code เช่น `LARK_TABLE_CONFIG_INVALID` ไม่ถูกเขียนทับ
- Wrong token ยังตอบ HTTP `401` และ
  `code=TIKTOK_POST_LARK_AUDIT_UNAUTHORIZED`
- Disabled route ยังตอบ `404`; non-GET ยังตอบ `405`
- Success ยังตอบ `200`, `mode=read_only` และไม่มี Queue/Business write
- Operator error สำหรับ non-`200` มี local code คงที่และ details เพียง
  `httpStatus` กับ `remoteCode`
- Raw response body, Authorization header และ Token ไม่ถูก persist หรือ report
- Existing confirmation, evidence-chain และ emergency safe-close tests ผ่าน

## Required verification

```text
npm ci
Focused TikTok Audit HTTP tests
Focused TikTok rollout operator tests
Workers runtime tests
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

## Implementation result

```text
IMPLEMENTATION_RESULT               = PASS_TIKTOK_AUDIT_ERROR_CODE_HOTFIX_IMPLEMENTATION
HTTP_FALLBACK_CODE                  = TIKTOK_POST_LARK_AUDIT_FAILED
KNOWN_ERROR_CODE_PRESERVATION       = IMPLEMENTED
OPERATOR_REMOTE_CODE_CAPTURE        = IMPLEMENTED
RESPONSE_REDACTION_STATUS           = PASS
QUEUE_OR_WRITE_PATH_ADDED           = false
FOCUSED_NODE_TESTS                  = 18 / 18 PASS
WORKERS_RUNTIME_TESTS               = 10 / 10 PASS
NPM_CHECK                           = PASS
NPM_TEST                            = 994 Unit + 10 Workers PASS
REPORT_RELIABILITY                  = 91 / 91 PASS
NPM_AUDIT                           = 0 vulnerabilities
DEPLOY_DRY_RUN                      = PASS / no deployment
REMOTE_ACTION_COUNT                 = 0
```

## Remaining gate

Draft PR review and merge, deployment, and any new Remote Audit require separate explicit approval.

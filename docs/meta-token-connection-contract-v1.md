# Meta Token Connection Preflight Contract v1

## Status

```text
CONTRACT_VERSION          = meta-token-connection-v1
APPROVED                  = 2026-07-25
RUNTIME                   = development / integration_workspace
BUSINESS_INGESTION        = OUT_OF_SCOPE
LARK_QUEUE_D1_WRITES      = FORBIDDEN
SCHEDULES                 = DISABLED
DEPLOYMENT                = NOT_AUTHORIZED
PRODUCTION                = BLOCKED
```

ผู้ใช้อนุมัติให้เตรียมตัวเชื่อมต่อก่อน โดยจะใส่/เปลี่ยน Credential และทำ
Live validation เมื่อบัญชีและ Token ลูกค้าพร้อม งานนี้จึงสร้างเฉพาะ
Token-based connection/preflight foundation สำหรับ:

1. Facebook Organic;
2. Instagram Organic ผ่าน Instagram Login;
3. Meta Ads แบบ Read-only.

ไม่มีการสร้าง Customer Connect link หรือ Meta OAuth callback ใน Contract นี้
เพราะลูกค้าส่ง Token แยกมาแล้ว

## Credential and runtime boundary

| Connector | Secret | Exact identity mapping |
| --- | --- | --- |
| Facebook Organic | `META_ACCESS_TOKEN` | `META_FACEBOOK_PAGE_ID` |
| Instagram Organic | `META_INSTAGRAM_ACCESS_TOKEN` | `META_INSTAGRAM_ACCOUNT_ID` |
| Meta Ads | `META_ACCESS_TOKEN` | `META_AD_ACCOUNT_ID` |

Common non-secret config:

```text
META_GRAPH_API_VERSION=vNN.N
```

Rules:

- Local Secret อยู่ใน ignored `.dev.vars` เท่านั้น.
- Deployed Secret ต้องใช้ Worker Secret/Secret store; ห้ามอยู่ใน Wrangler vars.
- Source, tests, docs, CLI output และ Operational error ห้ามมี Token, full external
  ID, username, Page name, Ad Account name หรือ customer identity.
- Facebook Organic และ Meta Ads เป็นคนละผล Connection แม้ใช้ Facebook Token
  เดียวกัน.
- `META_ACCESS_TOKEN` ใน Phase นี้ต้องเป็น Facebook User/System User credential
  ที่อ่าน `/me/accounts` และ `/me/adaccounts` ได้; Page access token สำหรับ
  Business ingestion เป็น Lifecycle คนละขั้นและยังอยู่นอก Scope.
- Instagram Login Token ไม่ใช้แทน Facebook/Meta Ads Token.
- Exact identity mapping เป็น Optional ระหว่าง Discovery แต่ต้องมีและ Match ก่อน
  ถือว่า Identity ผ่าน.

## Read-only provider calls

### Facebook Organic

```text
GET /me/permissions
GET /me/accounts?fields=id,instagram_business_account{id}
```

Required granted permissions:

```text
pages_show_list
pages_read_engagement
```

### Instagram Organic

Host:

```text
graph.instagram.com
```

Call:

```text
GET /me?fields=user_id,id,account_type
```

Successful identity response proves only the basic Instagram Login read path.
Account/media insights remain a later Live UAT gate.

### Meta Ads

```text
GET /me/permissions
GET /me/adaccounts?fields=id,account_id,account_status,currency,timezone_name
```

Required granted permissions:

```text
ads_read
business_management
```

No Campaign, Ad Set, Ad, Creative or Insights data is read in this phase.

## Result contract

Each connector returns one redacted result with:

- connector key;
- configured boolean;
- bounded candidate count;
- exact identity mapping configured/matched booleans;
- required/missing permission names only;
- status and sanitized provider error code;
- zero raw provider object, token, external ID or display name.

Allowed statuses:

```text
not_configured
provider_blocked
token_invalid
provider_unavailable
provider_error
scope_insufficient
identity_unavailable
identity_mapping_required
identity_mismatch
identity_validated
```

One connector failure must not hide the result of another connector. Retry and
response body size remain bounded in the shared Meta Graph transport; the body
limit is configured by `META_MAX_RESPONSE_BYTES`. Provider
`API access blocked` is reported as `provider_blocked`, not misclassified as
token expiry.

## Activation gates

- Connector catalog status remains `uat_pending`.
- Every Meta connector flag remains `false`.
- No Queue job type, schedule, Worker HTTP route or business-data writer is added.
- `identity_validated` is preflight evidence only; it is not Business ingestion
  readiness or Production approval.
- Live UAT must repeat with exact customer mappings, then verify token lifecycle,
  permissions, pagination, rate limits and large-account behavior before any
  connector can become `active`.

## Acceptance criteria

- [x] Runtime factory separates Facebook and Instagram credentials.
- [x] Facebook and Meta Ads share no result state despite using one credential.
- [x] Exact identity mismatch fails closed without exposing IDs.
- [x] Missing permissions are reported without exposing customer data.
- [x] Provider-blocked, invalid-token, transient and unexpected provider errors
      are classified separately.
- [x] CLI reads `.dev.vars` without shell evaluation and prints redacted output.
- [x] Tests prove GET-only behavior and zero Queue/Lark/D1/write path.
- [x] All feature flags and schedules remain disabled in release examples.
- [x] Focused tests and default Repository gates pass.

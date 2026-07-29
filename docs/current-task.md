# Current Task — TikTok Ads Customer Connect Readiness

## Authoritative status

```text
TASK_STATUS                         = APPROVED_FOR_REPOSITORY_IMPLEMENTATION
CURRENT_PROGRAM                     = TIKTOK_ADS_CUSTOMER_CONNECT_READINESS
BRANCH                              = integration/tiktok-ads-customer-connect-readiness
BASE_REF                            = main
IMPLEMENTATION_OWNER                = CHATGPT_WORK_GITHUB_TOOLS
REMOTE_ACTION_DURING_IMPLEMENTATION = NONE
WORKER_DEPLOYMENT                   = NOT_RUN
QUEUE_MESSAGE                       = NOT_SENT
D1_WRITE                            = NONE
LARK_WRITE                          = NONE
SCHEDULE_MUTATION                   = NONE
PRODUCTION                          = BLOCKED
```

## Objective

เตรียม TikTok Ads Customer Connect ให้พร้อมทั้งหมดใน Repository โดยใช้ Shared Customer Connect,
OAuth, credential encryption, connection lifecycle, Reliability, Queue/DLQ, D1 writer และ Lark
engine ที่มีอยู่แล้วให้มากที่สุด จนเหลือเพียง:

1. ลูกค้าสมัคร/เปิด TikTok for Business, Business Center, Advertiser และอนุมัติ App ตามข้อกำหนดของ TikTok;
2. ผู้ปฏิบัติงานกรอก non-secret customer identifiers/mappings ที่ได้รับจากลูกค้า;
3. ผู้ปฏิบัติงานตั้ง App ID/App Secret และ runtime secrets ผ่าน local Terminal;
4. ผู้ปฏิบัติงานรัน guarded Terminal operator หลังได้รับ authorization แยกต่างหาก.

งานนี้ไม่ทำ Customer authorization จริง, ไม่แลก token จริง, ไม่เรียก Provider จริง, ไม่ deploy,
ไม่ apply Remote migration, ไม่แก้ Remote Lark, ไม่ส่ง Queue message และไม่เปิด Schedule.

## Provider contract

ใช้ TikTok API for Business / Marketing API v1.3 สำหรับ Advertiser authorization และ read-only
reporting. Authorization URL ต้องมี exact callback URL, cryptographically random signed state และ scope
ที่จำเป็นเท่านั้น. Callback รับ `auth_code` และ `state`; `auth_code` เป็น single-use/short-lived และต้องถูก
แลกที่ server side เท่านั้น. Token และ App Secret ห้ามอยู่ใน URL, log, D1 plaintext, evidence หรือ Source.

Required provider operations for final Customer Connect:

```text
Advertiser authorization URL
POST /open_api/v1.3/oauth2/access_token/
GET  /open_api/v1.3/oauth2/advertiser/get/
GET  /open_api/v1.3/advertiser/info/
Read-only campaign/adgroup/ad/report endpoints approved by the locked source contract
```

Write-capable Campaign Management permissions and endpoints are out of scope.

## In scope

- Full repository audit before coding: duplicate logic, dead code, architecture, migrations, open PRs,
  shared Customer Connect/OAuth/credential modules, runtime routing, tests and operator patterns.
- TikTok Ads provider definition and exact read-only permission/scope contract.
- Reuse of existing signed invitation, state verification, callback routing, credential encryption,
  reconnect/token replacement lifecycle and exact provider identity validation.
- Additive TikTok Ads connection metadata/mapping support only where Shared Core cannot already express it.
- Advertiser allow-list and exact advertiser identity pinning; fail closed on zero, multiple unexpected or
  mismatched advertisers.
- Token redaction and sanitized error classification.
- Read-only connection validation with no Business fact writes.
- Customer input template containing only non-secret identifiers and mappings.
- Guarded local Terminal operator that defaults to plan/read-only and requires explicit confirmation per
  mutating phase.
- Unit, integration, Workers-runtime and focused regression tests.
- Documentation and final operator handoff commands.

## Out of scope

- TikTok Ads campaign/ad group/ad creation, update, pause, delete or budget mutation.
- TikTok Organic, TikTok Shop, TikTok One or Spark Ads post authorization implementation.
- New Reliability engine, Queue framework, DLQ, D1 generic writer, Lark sync engine or OAuth framework.
- Remote D1 migration/apply, Remote Lark schema/data mutation, Worker deployment, Queue message,
  Cron/Schedule activation, Production or Customer LIVE UAT.
- Storing App Secret, access token, auth code, refresh token or customer personal data in Source.

## Customer inputs remaining at final handoff

```text
customer_key              = chemistry_k
provider                  = tiktok_ads
business_center_id        = supplied by customer when available
advertiser_id             = supplied by customer and exact-pinned
advertiser_display_name   = optional non-secret verification hint
reporting_timezone        = Asia/Bangkok unless customer account proves otherwise
currency                  = provider-returned and exact-validated
app_id                    = runtime secret/config input; never committed
app_secret                = runtime secret only; never committed
callback_origin           = deployed customer-connect origin supplied at execution time
```

The customer must complete TikTok for Business registration and required Business Center/Advertiser/App
approval before live authorization can succeed.

## Safety invariants

- All TikTok Ads execution, D1-write, Lark-write and Schedule flags remain false in committed configs.
- Callback state is signed, expiring, single-use and provider/customer/connection scoped.
- Authorization code and token exchange are server-side only.
- Exact advertiser ID is verified before marking a connection validated.
- Any missing/mismatched advertiser, scope, provider identity, callback state or secret fails closed.
- Reconnect replaces the encrypted credential atomically without retaining plaintext or stale active tokens.
- Logs/evidence contain only sanitized codes, fingerprints and non-secret identifiers.
- No Provider mutation endpoint exists in the implementation.

## Acceptance criteria

1. Repository audit documents reused Shared modules and proves no duplicate OAuth/credential framework.
2. TikTok Ads Customer Connect invitation and callback route are provider-specific but use Shared Core.
3. Token exchange, advertiser discovery and advertiser validation are typed, bounded and read-only.
4. Exact advertiser mismatch and unexpected advertiser set fail closed.
5. Secrets/tokens/auth codes are redacted from logs, errors, health/admin responses and evidence.
6. Reconnect/token replacement lifecycle is idempotent and tested.
7. All committed TikTok Ads runtime flags are false; no Schedule or Provider mutation path exists.
8. Customer input template and Terminal operator reduce final work to entering customer data/secrets and
   running separately authorized commands.
9. Required gates pass:

```bash
npm ci
npm run check
npm test
npm run test:report-reliability
npm audit
npm run deploy:dry-run
```

10. No Remote action occurs during Implementation.

## Implementation result

Pending repository audit and implementation.

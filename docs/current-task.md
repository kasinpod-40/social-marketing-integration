# Current Task — TikTok Ads Customer Connect Readiness

## Authoritative status

```text
TASK_STATUS                         = REPOSITORY_IMPLEMENTED_CI_PASS_AWAITING_CUSTOMER_INPUTS
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
DRAFT_PR                            = 220
BRANCH_VERIFICATION                 = PASS
```

## Objective

เตรียม TikTok Ads Customer Connect ให้พร้อมทั้งหมดใน Repository โดยใช้ Shared Customer Connect,
OAuth, credential encryption และ connection lifecycle ที่มีอยู่แล้ว จนเหลือเพียงลูกค้าสมัคร/เปิด
TikTok for Business และส่ง Advertiser ID, ผู้ปฏิบัติงานตั้ง App ID/App Secret/Redirect URI ผ่าน
Terminal และรัน guarded invitation operator หลังได้รับ authorization แยกต่างหาก.

งานนี้ไม่ทำ Customer authorization จริง, ไม่แลก token จริง, ไม่เรียก Provider จริง, ไม่ deploy,
ไม่ apply Remote migration, ไม่แก้ Remote Lark, ไม่ส่ง Queue message และไม่เปิด Schedule.

## Implemented architecture

```text
existing signed retry-safe invitation
→ existing one-time signed OAuth state
→ TikTok Ads authorization route
→ server-side auth-code exchange
→ exact authorized advertiser set check
→ read-only advertiser/info validation
→ existing AES-256-GCM credential repository
→ existing D1 connection status authority
```

No new OAuth framework, D1 connection store, Queue, Reliability, Lark engine or schedule path was created.

## Provider contract

```text
GET/POST /connect/tiktok-ads
GET      /oauth/tiktok-ads/callback
POST     /open_api/v1.3/oauth2/access_token/
GET      /open_api/v1.3/advertiser/info/
```

Campaign, Ad Group, Ad, budget and other write-capable operations are out of scope.

## Customer inputs remaining

```text
customer_key              = chemistry_k
advertiser_id             = supplied by customer and exact-pinned
app_id                    = TikTok for Business app ID
app_secret                = Worker/local secret only
callback_uri              = https://<worker-host>/oauth/tiktok-ads/callback
```

Optional Business Center ID and display name remain verification metadata only. Currency and timezone are
accepted only from the validated Provider response.

## Repository implementation

- Registered `tiktok_ads` in the shared Customer Connection connector catalog and route-slug mapping.
- Added `TikTokAdsOAuthClient` for authorization URL construction and server-side code exchange.
- Added `TikTokAdsApiClient` for exact allow-listed advertiser validation through read-only advertiser info.
- Added `TikTokAdsCustomerOAuthFlow` using the existing invitation/state lifecycle, D1 store and encrypted
  credential replacement path.
- Added `provider_access_token` as an encrypted credential kind; plaintext is never persisted or returned.
- Added preview-safe GET, exact confirmation POST and callback routes to the existing HTTP composition.
- Added isolated runtime config for TikTok App ID/App Secret, redirect URI and approved Advertiser ID.
- Preserved Google Ads/YouTube runtime independence when TikTok Ads secrets are absent.
- Added plan-only-by-default Terminal operator:

```bash
node scripts/tiktok-ads-customer-connect-readiness.mjs
node scripts/tiktok-ads-customer-connect-readiness.mjs --execute
```

The execute mode creates one seven-day, three-attempt invitation only. It performs no Provider call, Queue
send, Lark write, Business sync or schedule mutation.

## Safety invariants

- Exact advertiser mismatch fails before credential persistence.
- Provider token is encrypted with existing AES-256-GCM authenticated-context binding.
- Callback result returns only masked advertiser identity and sanitized status.
- Queue and Lark outcomes remain explicitly false.
- TikTok provider secrets load only on TikTok Ads routes.
- No TikTok Ads mutation endpoint or schedule path exists.
- No secrets, signed invitation URLs or provider tokens are committed.

## Tests and CI

Focused coverage includes authorization URL secret isolation, token exchange normalization, duplicate advertiser
boundedness, exact advertiser validation, mismatch fail-closed behavior and provider runtime isolation.

Draft PR #220 Branch Verification passed all repository gates:

```text
Syntax architecture and hygiene  PASS
Focused staged TikTok tests      PASS
Unit and Workers runtime tests   PASS
Report reliability regression    PASS
Dependency audit                 PASS
Wrangler dry run                 PASS
```

## Operator documents

```text
docs/runbooks/tiktok-ads-customer-connect.md
docs/runbooks/tiktok-ads-customer-intake.md
```

## Implementation result

Repository implementation and CI verification are complete on the isolated Draft PR branch. Remote action
count remains zero. The only operational work intentionally left is customer TikTok registration/approval,
entering the exact customer Advertiser ID and App secrets through Terminal/Worker Secrets, separately reviewed
Worker deployment with all Business/Schedule flags false, and running the guarded invitation command.

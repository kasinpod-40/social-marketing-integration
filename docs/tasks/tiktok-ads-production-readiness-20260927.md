# TikTok Ads Customer Production readiness — 2026-09-27

## Authority and acceptance

ผู้ใช้อนุมัติ Production end-to-end โดยใช้ shared OAuth v2 / encrypted credential / Paid Ads canonical /
Lark writer / Report / Queue / schedule เดิมทั้งหมด เริ่มจาก current main `54506f73` และไม่ revive #220,
ไม่แตะ #661, TikTok Organic หรือ Business data ของช่องทางอื่น

PR นี้แก้เฉพาะ callback credential lifecycle ก่อน customer authorization; ingestion/report/schedule
ยังต้องผ่าน Source proof และ reconciliation ตามลำดับ ไม่ถือว่า OAuth หรือ TikTok Ads COMPLETE

## Provider contract correction

Official TikTok API for Business v1.3 search (`long-term access token`) ยืนยันว่า Ads ใช้ long-term access token
และ `/oauth2/refresh_token/` deprecated ไม่ใช้ creator token lifecycle จาก SDK description ที่รวม Organic
เข้าเป็น Ads contract: https://business-api.tiktok.com/portal/search?s=long-term+access+token&type=0&version=1.3

Code exchange ต้องรับ access-only response ได้ เก็บ `access_token` ใน shared encrypted repository ด้วย
AAD kind `access_token`; ไม่มี synthetic refresh token, ไม่มี refresh request และไม่มี plaintext ใน D1.
Expiry ที่ Provider ส่งมายังถูกตรวจและเก็บ; absence เป็น null และ grant ใช้ได้จน Provider revoke.
Advertiser ID/name/timezone/currency ต้องครบก่อนเก็บ credential.

Migration `0024_customer_access_token_credentials.sql` ขยาย CHECK ในตารางเดิมด้วย transactional rebuild:
copy ทุก ciphertext/IV/AAD/key version/status/timestamp/reference โดยไม่ decrypt หรือ rewrite payload;
รักษา self-reference, PKCE foreign key, indexes และ one-active uniqueness.
D1 migration อยู่ใน implicit transaction และ defer foreign keys เฉพาะระหว่าง rebuild:
https://developers.cloudflare.com/d1/sql-api/foreign-keys/

## Exact live preparation evidence

- account `154f6bf72740d29d7453cec7fb800d32`, profile `chemistry-k-prod`;
- Worker `social-mkt-sync-worker`, version `e0e8fbf1-86f9-43fb-b2c2-f12362582683` at 100%;
- D1 `social-mkt-state-prod`, ID `f03ab092-a1aa-4478-8ba2-c20d7b54851f`;
- tuple `production / chemistry_k / chemistry_k` confirmed from active bindings;
- active bindings 240 plain text + 10 Secrets + D1 + Queue = 252 resources / 250 text;
- migration 0023 table already exists; initially zero runtime_config rows;
- scoped empty runtime_config SQL backup SHA256
  `921b35c94124a3e9b7c38febaf7420c092589b5039996c95359372c60abab023`;
- Time Travel bookmark `000019dc-000002e8-000050f3-e9426dc48cdd7199c455f5913c0873fd`;
- migrated 34 exact active LARK_TABLE values + TikTok App ID `7670007933899390993`, 35/35 exact readback;
- candidate prunes only 34 Lark bindings: 250 → 216 text, 34 headroom; active version not changed;
- `MKT_CONNECTION_PUBLIC_ORIGIN` is still placeholder, workers.dev and Preview disabled, no routes;
- TikTok App Secret and shared OAuth signing/operator secrets are absent. Never ask for values in chat;
  provision through candidate-version secret flow from customer-controlled private file or Dashboard.

Whole Customer D1 local export was rejected by automatic approval review because it included sensitive
Customer payload. No bypass or full export occurred. Scoped non-secret table backup and retained D1
Time Travel cover this additive runtime_config mutation without copying Business data.

## Verification and remaining rollout

Focused SQLite migration proves replaced/self-reference and PKCE preservation, foreign_key_check,
CHECK/unique constraints, real encryption, wrong-kind/connector rejection and credential replacement.
Focused Workers test verifies shared migrated D1 and Web Crypto access-token lifecycle.
Existing Google/YouTube/Instagram token behavior is preserved.

Full gates and reviewed exact-head merge must precede remote migration/candidate activation.
No Source API Business read, Ads fact/Lark write, Report activation, schedule activation or traffic switch
has occurred in this preparation. Real OAuth access is required for all later live acceptance criteria.

Local validation: npm ci PASS; npm run check PASS (865 source files, 2666 dependencies, zero cycles/hygiene);
final unit suite 3471 PASS plus focused 9 PASS; Workers runtime 19 PASS including the new
access-token test; report reliability 106 PASS; npm audit zero vulnerabilities; deploy dry-run PASS.
Workers tests required localhost access outside sandbox; npm audit required registry network access.

## Customer retry UX — 2026-10-01

Exact Customer D1 readback showed one OAuth attempt at 11:28 Asia/Bangkok without a consumed callback or
validated connection. A duplicate browser POST during the active window exposed raw JSON. The shared
confirmation button now says TikTok Ads for this connector, and active repeat POSTs redirect to the
read-only invitation preview. No Ads Business or credential write is introduced; customer authorization
still requires live callback proof. A subsequent CI run found a high-severity advisory in the existing
Cloudflare development-tooling dependency graph. Wrangler and Workers test pool were updated, with undici
pinned to the patched 7.29.1; clean install, all gates and full audit now pass.

# Google Ads Manager Script One-time Signing Secret Provisioning Design v1

## Status and boundary

```text
DESIGN_ID                 = google_ads_manager_script_secret_provisioning_v1
DESIGN_STATUS             = LOCAL_DESIGN_COMPLETE
IMPLEMENTATION            = NOT_STARTED
REMOTE_MIGRATION          = NOT_AUTHORIZED
PROVISIONING_ENDPOINT     = NOT_IMPLEMENTED
PROVISIONING_FLAG         = DEFAULT_FALSE
SIGNED_INGRESS            = DISABLED
QUEUE_LARK_BUSINESS_WRITE = DISABLED
SCHEDULE_LIVE_PRODUCTION  = DISABLED
```

เอกสารนี้กำหนดวิธีส่ง Signing Secret จาก Cloudflare Worker Secret ไปยัง
Google Ads Manager Script Properties แบบใช้ Ticket อายุสั้นและใช้ได้ครั้งเดียว
โดยไม่มี Secret อยู่ใน Repository, helper source ถาวร, D1, Queue, Lark, Log
หรือหลักฐาน UAT

การอนุมัติ Design นี้ไม่อนุญาตให้เพิ่ม Migration/Endpoint, สร้าง Ticket,
เปลี่ยน Worker Secret, Deploy, เปิด Signed ingress หรือรัน PREVIEW delivery.
Implementation และ Remote rollout ต้องเป็น Approval gate แยก

## Problem

Google Ads Script UI ไม่ได้ให้ Project Settings surface แบบ Apps Script editor
ทั่วไปสำหรับตั้ง Script Properties ด้วยมืออย่างสม่ำเสมอ แต่ Script ใช้
`PropertiesService.getScriptProperties()` และเขียนค่าได้ด้วย
`setProperty()`/`setProperties()`.

ห้ามใช้ temporary setter ที่ฝัง Signing Secret จริงใน source เพราะ source และ
revision history อาจคง Secret ไว้หลังลบ code แล้ว

## Security goals

- Signing Secret จริงอยู่ใน Cloudflare Secret และ Google Script Properties เท่านั้น
- Repository และ D1 เก็บได้เฉพาะชื่อ Secret, Key ID และ Fingerprint
- One-time Ticket มี entropy อย่างน้อย 256 bits, TTL 5 นาที และผูก exact
  Environment/Manager/Advertiser/Key ID
- Ticket ถูก Consume แบบ Atomic และไม่สามารถ Redeem ซ้ำ
- Script ยืนยัน HMAC challenge หลังเก็บ Secret ก่อนถือว่า Provision สำเร็จ
- Endpoint คืน `404` เมื่อ Provisioning flag ปิด
- Endpoint ใช้ HTTPS, exact path/method, bounded body และ `Cache-Control: no-store`
- Response body, Authorization header, Ticket, Secret และ exact identity ไม่เข้า Log
- Provisioning ไม่ขึ้นกับ Signed-ingress, Connector หรือ Business-write flags
- ไม่มี Queue send, Business D1 write, Lark write, Schedule หรือ Ads mutation

## Non-goals

- ไม่ Rotate Signing Secret อัตโนมัติ
- ไม่อ่าน Secret คืนจาก Google Script
- ไม่เปิด Signed PREVIEW/LIVE delivery
- ไม่สร้าง Public operator endpoint สำหรับออก Ticket
- ไม่ใช้ Customer OAuth, Google Drive, Spreadsheet, Mail หรือ Trigger
- ไม่เก็บ Ticket plaintext หรือ Signing Secret ใน D1
- ไม่แก้ Ads, Campaign, Budget, Bidding หรือ Spend

## Proposed flow

```text
Approved local operator creates CSPRNG Ticket
→ operator writes only SHA-256 Ticket fingerprint + exact binding + TTL to D1
→ plaintext Ticket is shown once and pasted only into a temporary Script helper
→ helper verifies current Manager and selectable Advertiser locally
→ helper POSTs bounded redeem request over HTTPS
→ Worker checks provisioning flag, runtime identity and atomic Ticket consume
→ Worker returns Key ID + Signing Secret + random challenge once
→ helper writes Key ID/Secret to Script Properties
→ helper returns HMAC proof over the exact challenge
→ Worker verifies with its Secret and atomically marks Ticket confirmed
→ helper logs only a sanitized success code
→ operator removes the temporary helper; Ticket is already unusable and expires
→ provisioning flag is restored/kept false
```

The short-lived Ticket may briefly exist in Google Ads Script revision history.
It is not the Signing Secret and becomes unusable immediately after Atomic
redeem or after five minutes. A Ticket that reaches `redeemed` but not
`confirmed` is failed closed; issue a new Ticket only after explicit review.

## Proposed runtime contract

Feature flag:

```text
MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED=false
```

Worker Secret reused as the current delivery key:

```text
MKT_GOOGLE_ADS_SIGNING_SECRET
```

Non-secret runtime binding:

```text
MKT_GOOGLE_ADS_SIGNING_KEY_ID
MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID
MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID
MKT_CUSTOMER_PROFILE
MKT_ENV
```

Proposed exact routes:

```text
POST /v1/google-ads/manager-script/signing-secret/redeem
POST /v1/google-ads/manager-script/signing-secret/confirm
```

Both routes must return `404` before loading D1/Secret when the Provisioning
flag is false. They must remain independent of:

```text
MKT_CONNECTOR_GOOGLE_ADS_ENABLED
MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED
MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED
```

## Ticket persistence

Proposed additive table:

```text
google_ads_signing_provisioning_tickets
```

Permitted fields:

```text
ticket_fingerprint       SHA-256 Base64URL / primary key
identity_fingerprint     SHA-256 of environment/customer/profile/account binding
key_id                   non-secret current Key ID
status                   active | redeemed | confirmed | expired | cancelled
created_at               Unix milliseconds
expires_at               Unix milliseconds / maximum created_at + 5 minutes
redeemed_at              nullable Unix milliseconds
confirmed_at             nullable Unix milliseconds
challenge_fingerprint    nullable SHA-256 Base64URL
```

Forbidden fields:

```text
ticket plaintext
signing secret
raw challenge
raw Manager/Advertiser identity
request/response body
Authorization header
```

Ticket creation is a guarded local operator action that writes D1 directly only
after a separately approved Remote migration. There is no HTTP route that
creates Tickets.

## Redeem request

```http
POST /v1/google-ads/manager-script/signing-secret/redeem
Authorization: Bearer <one-time-ticket>
Content-Type: application/json
```

Exact canonical JSON body, maximum 4 KiB:

```json
{
  "schemaVersion": "google_ads_signing_secret_provisioning_v1",
  "managerCustomerId": "0000000000",
  "customerId": "0000000000",
  "customerKey": "profile-derived-value",
  "accountKey": "connector-derived-value",
  "keyId": "non-secret-key-id",
  "clientNonce": "base64url-16-byte-value"
}
```

Validation order:

1. exact HTTPS method/path and Provisioning flag;
2. exact Content-Type, one Authorization header and 4 KiB body cap;
3. Ticket format and SHA-256 fingerprint;
4. canonical JSON and exact field allowlist;
5. runtime Environment/Profile/Manager/Advertiser/Key ID match;
6. D1 Atomic consume where `status=active` and `expires_at >= now`;
7. load current Signing Secret;
8. generate CSPRNG 32-byte challenge;
9. persist only challenge fingerprint and `redeemed` state;
10. return one bounded no-store response.

Success response fields:

```json
{
  "ok": true,
  "status": "redeemed_pending_confirmation",
  "keyId": "non-secret-key-id",
  "signingSecret": "returned-once-only",
  "challenge": "base64url-32-byte-value"
}
```

Any replay of the redeem request returns a bounded `409` without Secret.
Network loss after Atomic consume requires a new Ticket; the old Ticket must not
be reset to `active`.

## Confirmation proof

After writing Key ID and Secret with
`PropertiesService.getScriptProperties().setProperties(...)`, the helper signs:

```text
MKT-GOOGLE-ADS-PROVISIONING-CONFIRM-V1
<keyId>
<clientNonce>
<challenge>
```

Confirmation uses the same Ticket as a bearer capability plus:

```text
x-mkt-provisioning-proof: sha256=<HMAC-SHA-256 lowercase hex>
```

The Worker:

1. loads only the `redeemed` Ticket row;
2. verifies exact identity/key binding and challenge fingerprint;
3. verifies HMAC with the Worker Signing Secret using Web Crypto;
4. atomically moves `redeemed → confirmed`;
5. returns only `{ "ok": true, "status": "confirmed" }`.

An exact confirmation replay may return the same sanitized `confirmed` result
but must not return the Signing Secret.

## Temporary Script helper rules

- helper source in Repository contains placeholders only
- real Ticket is pasted only after it is created and expires within five minutes
- helper calls no API except the exact HTTPS provisioning routes
- helper verifies current Manager and exact selectable Advertiser before Redeem
- helper does not log Ticket, Secret, Key ID, Customer ID, response body or proof
- helper writes only:
  `MKT_GOOGLE_ADS_SIGNING_KEY_ID` and `MKT_GOOGLE_ADS_SIGNING_SECRET`
- helper never sets mode to `PREVIEW`/`LIVE` and never enables delivery
- helper is removed from the Google Ads Script immediately after confirmation
- a sanitized confirmation code is the only permitted evidence

The existing delivery Script remains `DRY_RUN` and
`MKT_GOOGLE_ADS_DELIVERY_ENABLED=false` throughout provisioning.

## Required tests before implementation can merge

- Ticket: entropy/format/hash, exact binding, TTL, expired/cancelled/replay
- D1: additive migration, Atomic single consume race, no plaintext columns
- HTTP: disabled route `404` before D1/Secret, method/content/header/body bounds
- Identity: Environment/Profile/Manager/Advertiser/Key ID mismatch
- Secret: returned only on first successful redeem and never logged
- Challenge: valid/tampered/wrong-key/replayed confirmation
- Script helper: exact account guard, placeholder-only, no Secret literal/log
- Regression: Signed ingress remains disabled, delivery route unchanged
- Side effects: zero Queue, Business D1, Lark, Schedule and Ads mutation
- Full Repository Definition of Done gates

## Rollout approval gates

1. Approve local implementation and additive Migration source.
2. Review focused/full tests and source safety scan.
3. Approve commit/push/PR separately.
4. Approve Remote backup + Migration separately.
5. Approve flags-false deployment separately.
6. Approve one Ticket creation and five-minute provisioning window separately.
7. Confirm challenge and remove helper.
8. Verify Ticket/Secret/redaction and zero Business side effects.
9. Keep Provisioning and Signed-ingress flags false.
10. Request a separate approval for actual signed PREVIEW delivery.

LIVE, Queue admission, Business writer, Lark write, Schedule and Production
remain outside every provisioning approval gate.

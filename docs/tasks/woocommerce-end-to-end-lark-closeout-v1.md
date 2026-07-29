# WooCommerce End-to-End D1 + Lark Closeout v1

## Objective

ทำ WooCommerce ของ `chemistry_k` ใน Integration Workspace ให้ครบจาก Provider diagnostics
ไปจน D1/Lark parity, same-operation replay และ all-false Safe restore โดยไม่เปิด Production
หรือ Schedule/Cron.

```text
MKT_ENV               development
MKT_CUSTOMER_PROFILE  integration_workspace
account_key            chemistry_k
Production             false
Schedule/Cron          disabled
```

## Phase 1 — Preview URL pair classifier

Live diagnostics ก่อนแก้คืน Wrangler Preview URLs สองชนิดใน `version-upload` เดียว:

```text
aliased Preview URL
versioned Preview URL
```

Parser เดิมถือ distinct origins มากกว่าหนึ่งค่าเป็น ambiguous จึงหยุดก่อน Provider request.
Classifier ใหม่จำแนกแต่ละ declared candidate เป็น:

```text
aliased_preview
versioned_preview
invalid_or_foreign
```

Contract:

- deterministic aliased origin ยังคงเป็น request target เพียงค่าเดียว;
- ยอมรับ no URL, alias-only, versioned-only, alias+versioned และ duplicate ค่าเดิม;
- distinct aliased origin หรือ distinct versioned origin มากกว่าหนึ่งค่าต้อง fail closed;
- Versioned URL ต้องเป็น HTTPS, ไม่มี credential/port/path/query/hash และตรง Worker/account
  workers.dev identity;
- candidate extraction จำกัดที่ `preview_url`, `previewUrl`, `preview_urls`, `previewUrls`,
  `targets`, `urls` และ nested values ภายใน containers เหล่านี้;
- malformed, foreign Worker/account, custom domain และ unsafe URL ต้อง fail closed;
- evidence เก็บเฉพาะ fingerprints/counts ไม่มี raw origin/account identity.

Active และ Safe Preview uploads ใช้ alias identity เดียวกัน. Operator probe และ authenticated
Provider GET ใช้ `previewOrigin` ที่สร้างจาก deterministic alias เท่านั้น ไม่ใช้ Versioned URL.
Provider request attempt ยังคงสูงสุดหนึ่งครั้ง และ Queue sentinel ยังคง `retryAll()` exactly once.

## Repository verification

```text
Focused classifier/runtime tests       36/36 PASS
npm ci                                 PASS
npm run check                          PASS
Unit                                   1460/1460 PASS
Workers runtime                        15/15 PASS
Report reliability                     100/100 PASS
npm audit                              0 vulnerabilities
npm run deploy:dry-run                 PASS
```

Workers runtime ต้อง rerun นอก restricted sandbox เพราะ Wrangler ต้องเขียน log และ bind
localhost; failure แรกเป็น `EPERM` จาก sandbox หลัง Unit ผ่านทั้งหมด.

## Remote boundary before merge

Repository implementation/CI นี้ยังไม่ทำ Live mutation:

```text
Provider request          0
Worker Version upload     0
Production deployment     0
Queue message             0
D1/Lark mutation          0
Schedule mutation         0
Production traffic change 0
```

หลัง exact-head Branch Verification และ Squash Merge จึงรัน Preview diagnostics window ตาม
scoped authorization แล้วดำเนิน failed-operation recovery และ Final D1/Lark rollout ต่อ.

## Live diagnostics after PR #251 merge

PR `#251` Squash Merged at `a4bfd16daac6bc47a5296687fb4f843e7f132847`.
Guarded Preview diagnostics then passed the Preview classifier/window contract:

```text
Active Preview Version       45e477d7-b3d8-44a6-bf7c-50fc36ce5b7d
Safe Preview Version         8789af34-0d40-425a-a549-7eb8957b7cbe
Provider request             1
Provider mutation            0
Queue/D1/Lark/Schedule       0
Preview URLs restored        true
workers.dev restored         disabled
Production baseline version 8284c076-49ed-4ffc-bba9-f2e0839aa1c5
Production unchanged         true
```

Provider returned HTTP `200` with declared `application/json` but the bounded parser classified
the 51,479-byte body as `html_or_xml`, so diagnostics returned `WOOCOMMERCE_INVALID_JSON`.
An unauthenticated public GET to the exact source/route with the Worker Accept/User-Agent headers
returned the expected JSON `401`; therefore hostname/path/header routing is valid and the
difference occurs only after credential processing.

The next repository hotfix adds booleans only for followed-redirect/final-target classification:

```text
responseRedirected
responseUrlPresent
responseOriginMatchesSource
responsePathMatchesResource
```

No raw response URL, body, prefix, header, credential or Secret value is retained. The hotfix
does not accept contaminated JSON and does not change Provider request/retry semantics.

## Live Provider diagnostics after PR #252 merge

PR `#252` Squash Merged at `527cdceda2d4661c82dc000380705d1078343bdf`.
The guarded rerun completed successfully:

```text
Active Preview Version       5c6b252a-334e-4edf-9986-e555ad339320
Safe Preview Version         048ca321-bbd9-4578-8ead-ee0953da0b89
Provider request             1 / PASS
WooCommerce / WordPress      10.6.2 / 6.9.4
Store currency               THB
Provider/Business mutations  0
Queue/D1/Lark/Schedule       0
Preview URLs restored        true / disabled
Production baseline version 8284c076-49ed-4ffc-bba9-f2e0839aa1c5
Production unchanged         true
```

The earlier HTML/XML response did not reproduce and the bounded redirect indicators confirmed
the successful response without retaining its URL or body.

## Exact stale-operation recovery

Read-only inspection of `woo-final-full-6f43ac8ee857` on the same main classified it as
`TERMINAL_FAILED` with stale active durable work, zero active locks, exactly one Queue attempt,
zero Coverage and zero rows across all 14 WooCommerce Business tables. The recovery-only operator
is therefore repinned to this exact operation and confirmation:

```text
CONFIRM_WOOCOMMERCE_RECOVERY_ONLY=RECOVER_WOO_FINAL_FULL_6F43AC8EE857_ONLY
```

It retains the existing guarded lifecycle-only mutation and pre/post verification. It cannot
deploy a Worker, send Queue work, write Business/Coverage/Lark rows or delegate to rollout.

Repository verification for the repin:

```text
Focused recovery/inspector tests  20/20 PASS
npm ci                            PASS
npm run check                     PASS
Unit                              1461/1461 PASS
Workers runtime                   15/15 PASS
Report reliability                100/100 PASS
npm audit                         0 vulnerabilities
npm run deploy:dry-run            PASS
```

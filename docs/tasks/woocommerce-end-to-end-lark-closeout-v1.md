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


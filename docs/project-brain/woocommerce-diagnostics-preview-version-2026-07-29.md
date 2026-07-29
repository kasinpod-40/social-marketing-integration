# WooCommerce diagnostics Preview Version — 2026-07-29

## Deterministic origin correction — 2026-07-30

หลัง Queue sentinel fix, Live operation สร้าง Active และ automatic Safe Preview Version สำเร็จ
รวม 2 uploads แต่ Wrangler 4.110.0 ไม่ส่ง Preview URL ใน array shape ที่ parser เดิมรองรับ.
Operator จึงหยุดก่อน Provider request ด้วย `PREVIEW_URL_INVALID` ทั้งที่ upload สำเร็จ.
Preview URL setting ถูก restore, workers.dev ยัง disabled และ Production deployment
`8284c076-49ed-4ffc-bba9-f2e0839aa1c5` คงเดิม.

Current repository correction ใช้:

```text
https://<alias>-<worker>.<validated-account-subdomain>.workers.dev
```

Existing wrapper อ่าน account subdomain ผ่าน Cloudflare account API แบบ GET-only และส่งต่อเฉพาะ
validated DNS label. Structured `version-upload` exactly one และ valid version ID ยังคงเป็น
authority; Wrangler URL ไม่บังคับ แต่ถ้ามีต้องตรง deterministic origin ทุกตัว. Raw origin,
subdomain, account ID และ token ไม่ถูกพิมพ์หรือ persist.

Command-failed evidence นับ captured files แยกจาก failures และไม่สร้าง false failure จาก
successful `version-upload` หรือ application-level child exit.

Implementation/CI ไม่มี Remote action และ Live rerun ยังไม่ได้รับอนุญาต. รายละเอียด:
`docs/tasks/woocommerce-diagnostics-preview-origin-v1.md`.

## Latest verified fact

The authorized diagnostic on `main@511b07716c047be83a9f84d90f1de603d4f330bb` stopped before Provider access:

```text
code                         WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_MISMATCH
Active response              HTTP 404 / no attestation
Active control plane         exact version and exact flag passed
Provider request             0
Safe response                HTTP 404 / no attestation
Safe control plane           exact version and zero flags passed
Worker deployments           2
Queue / D1 / Lark / Schedule 0
```

The production Worker was restored and verified all-flags-false. The result proves the configured public URL could not attest that it reached the reviewed Worker version.

## Current correction

Branch:

```text
hotfix/woocommerce-diagnostics-preview-version
```

The diagnostic now uploads isolated Cloudflare Preview Versions without deploying them to production traffic. A dedicated Preview-only entrypoint exposes only the guarded WooCommerce diagnostic GET route.

The Preview configuration contains no production routes, Cron, Queue, D1, storage, service, workflow or asset binding. Production deployment identity and zero execution flags are checked before, during and after the Preview operation.

Active and Safe Preview versions share a random alias. Active requires the one-time local authorization and returns an Active attestation. Safe replaces the alias target, has zero true flags and returns a distinct Safe attestation.

Wrangler upload results are accepted only from one structured `version-upload` ND-JSON record. Preview URLs are not persisted.

## Next sequence

```text
exact-head CI
→ Squash Merge after explicit authorization
→ separate authorization for two Preview Version uploads and one Provider GET
→ review Provider result
→ keep Final rollout and stale-work recovery blocked until review
```

No Remote action was performed while implementing this correction.

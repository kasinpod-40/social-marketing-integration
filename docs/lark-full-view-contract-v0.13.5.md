# Lark Full View Contract v0.13.5

## Status and approval

- **Contract status:** `implemented_and_verified_in_dev`
- **Approved by:** user instruction `จัดการ 4 ข้อเลย` on 2026-07-22
- **Target:** developer-owned DEV / `dev_ft_pumkin`
- **View population:** 133 Views across 42 physical tables
- **Source audit:** `docs/Lark_Full_View_Audit_v0.13.5.md`
- **Pre-Apply source export SHA-256:** `57968b84ccf4b34f50830dddaccfba4cb7ff2e23773eeef664d8b2db9210eaa1`
- **Post-Apply verification export SHA-256:** `704c10ea6fb1cd0790949cbc94a0865398521f00f7695a4f8ef5e8aa3c4c3ef2`
- **Post-Formula verification export SHA-256:** `3f177a1c2639da506c3e76e2d72bb9a018ccfb7ad29a38cbbca986b863d4b6c8`
- **Business Record scope:** prohibited
- **Create/Delete/Rename Table, Field, View or Record:** prohibited

สัญญานี้แยก `managed business contract` ออกจาก `baseline-preservation contract` เพื่อไม่อนุมานเงื่อนไขจากชื่อ View. ทุก View มีสถานะที่ชัดเจนใน Full matrix แต่ Apply จัดการเฉพาะ 19 Google Ads Views ที่มี executable Filter contract อยู่ก่อนแล้ว.

## Contract classes

| Class | Views | Filter contract | Sort contract | Hidden-field contract | Apply behavior |
|---|---:|---|---|---|---|
| Managed contract — already correct | 25 | Exact conjunction/conditions จาก Source | Report 6 Views ใช้ `rank asc` automatic; ที่เหลือ unspecified | Exact Source contract | Verify only |
| Managed Google contract | 17 pending + 2 correct | Exact conjunction/conditions ใน `google-ads-view-filters.js` | None | None | PATCH Filter only; no create/delete/rename |
| All/default baseline | 36 | None | None | None ยกเว้น `RAW_TikTok_Creator_Videos / 📋 All Records` คง `SourceID` hidden | Preserve and verify |
| Legacy specialized baseline | 55 | None | None | None | Preserve and verify; no business meaning inferred from View name |

ยอดรวม `25 + 17 + 36 + 55 = 133`. Google Views ที่ถูกต้อง 2 รายการรวมอยู่ใน 25 และรวมอยู่ใน managed Google contract 19 รายการด้วย; Apply Preview ต้องจึงแสดง action เพียง 17 รายการ.

## Baseline-preservation rule

สำหรับ Specialized Views 55 รายการที่ไม่มี exact Repository/Workbook contract:

1. Purpose คือ `legacy saved view preserved for owner/admin inspection`; ไม่อ้างว่า Filter สอดคล้องกับคำเช่น Active, Latest, Failed หรือชื่อ Platform.
2. Filter = `NONE`, Sort = `NONE`, Hidden fields = `NONE` ตาม Live/export ที่ตรวจเมื่อ 2026-07-22.
3. ห้ามเปลี่ยน presentation state จนกว่าจะมี business-owner contract ใหม่ที่ระบุ Table + exact View name + purpose + conjunction + conditions + sort + hidden fields.
4. Contract ใหม่ต้องเป็นงานแยกและต้องไม่ใช้ชื่อ View เป็นหลักฐานเพียงอย่างเดียว.

กฎนี้ทำให้ state ปัจจุบันตรวจ drift ได้โดยไม่แต่ง business logic ที่ไม่มีหลักฐาน. รายชื่อและสถานะครบทุก View อยู่ใน Full matrix ของ Audit document.

## All/default policy

สำหรับ All/default Views 36 รายการ:

- Filter = `NONE` เพื่อคง complete-table inspection.
- Sort = `NONE` เพื่อไม่สร้าง ordering semantics ที่ไม่มีหลักฐาน.
- Hidden fields = `NONE` โดย Default.
- Exception: `RAW_TikTok_Creator_Videos / 📋 All Records` คง hidden field `SourceID` ตาม Native-source presentation state; ไม่มี API mutation ในงานนี้.
- Audience = owner/admin only เว้นแต่ Advanced Permission contract ของตารางนั้นอนุญาตเป็นอย่างอื่น.

## Managed Google Filter contract

Source of truth: `packages/config/src/google-ads-view-filters.js`.

- 13 RAW error Views: Primary stable-key field `isEmpty` ด้วย conjunction `and`.
- `Google Ads Accounts`: `platform is google_ads`.
- `YouTube Ads Campaigns`: `platform is google_ads AND ad_channel is youtube_ads`.
- `Google Ads Daily 30D`: OpenAPI-managed `platform is google_ads`; Lark UI-managed `metric_date rolling Last 30 days inclusive`.
- `YouTube Video Assets`: `platform is google_ads AND creative_type is video`.
- `Performance Max Asset Groups`: `platform is google_ads`.
- `Conversion Actions UAT`: `status is ENABLED OR status is UNKNOWN`.

Filter และ Hidden fields ต้องส่งคนละ mutation. Select values ต้อง Resolve เป็น Live Option IDs. Empty-key conditions ต้องใช้ valueless `isEmpty`. Apply ต้อง Hydrate View ด้วย Get View ก่อนเทียบ state และต้องผ่าน Final Preview zero drift.

## Sort and Hidden-field policy

- Report Views 6 รายการคง `rank ascending` และ Automatic sorting ตาม current Source/Live export.
- Google managed Views 19 รายการไม่มี managed Sort และไม่มี hidden fields.
- All/default 36 และ legacy specialized 55 ใช้ baseline policy ด้านบน.
- OpenAPI Apply รอบนี้ห้ามแก้ Sort หรือ Advanced Permission.

## Apply gate

อนุญาต Apply ต่อเมื่อครบทุกข้อ:

1. Working tree diff มีเฉพาะ Contract, guarded View tooling, tests และ handoff docs.
2. Focused tests และ `npm run check` ผ่าน.
3. Read-only Preview เป็น DEV / `dev_ft_pumkin`, conflicts = 0, creates = 0, deletes = 0, renames = 0, record writes = 0 และ update actions = 17.
4. Action list ตรง exact Table/View/Filter contract.
5. Apply ใช้ explicit command `CONFIRM_WRITE=YES npm run setup:google-ads-view-filters:apply`.
6. Apply สำเร็จแล้วต้อง Preview ซ้ำเป็น zero actions.
7. Rolling Last-30-days UI condition ต้องตรวจกลับจาก export ก่อนปิด manual handoff.

## Out of scope

- Formula expressions 4 Fields ซึ่งเป็น manual Lark Field UI handoff แยกจาก View contract;
- Connector/source API, Business Record, Worker, Queue, D1, Cron/Schedule, Secret, deployment และ Production;
- การเปลี่ยนชื่อหรือสร้าง View เพื่อทำให้ legacy specialized View ดูสอดคล้องกับชื่อ;
- การเปิด Client permission ให้ RAW/Daily/Sync/System tables.

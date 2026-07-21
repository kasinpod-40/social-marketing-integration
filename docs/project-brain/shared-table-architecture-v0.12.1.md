# Shared-table Architecture v0.12.1

## Decision

คำสั่งล่าสุดของผู้ใช้ยืนยันให้กลับสู่แนวทางเดิมของ Base:

- ตารางกลางใช้ร่วมกันข้าม Platform;
- แยกการดูตามช่องทางด้วย `platform`, `entity_type` และ Lark Views;
- ไม่สร้าง Table ตามจำนวน API endpoint;
- ตรวจตารางเดิมก่อนเพิ่ม Table ใหม่;
- `RAW_TikTok_Creator_Videos` เป็นตาราง Source ที่ Lark Native TikTok ควบคุมและระบบเราห้ามแก้ทุกกรณี.

Physical layout แบบ 14 Meta Raw tables ใน v0.12.0 จึงถูกยกเลิกก่อน Apply จริง ส่วน Identity, timestamp, timezone, zero/null, money-micros และ Ad-versus-Creative semantics ของ v0.12.0 ยังคงใช้ต่อ.

## Evidence จาก Base export ปัจจุบัน

ไฟล์ `.base` ที่ผู้ใช้ส่งถูกตรวจแบบ Local และไม่ Commit เข้า Repository:

- 26 unique tables;
- 4,641 records;
- 352 fields;
- 81 views;
- 1 duplicate snapshot block ของ `MKT_Report_Top_Content` แต่เป็น Table เดียว ไม่ใช่ Table ซ้ำจริง;
- Planned Raw tables 5 ตารางมี 0 records และยังไม่มี Active connector จึงใช้เป็น In-place slots ได้;
- Canonical Content/Ads tables มี Views แยก TikTok, YouTube, Facebook, Instagram, Meta, TikTok Ads และ Google Ads อยู่แล้ว จึงยืนยันว่า Shared-table + View เป็น Direction เดิมของระบบ.

รายละเอียด Sanitized อยู่ที่ `docs/shared-table-blueprint-v0.12.1/current-base-inventory.csv` และ `duplicate-review.csv`.

## Protected source rule

`RAW_TikTok_Creator_Videos`:

- Owner: `lark_native_tiktok_for_creator`;
- Access: read-only source;
- Allowed: list/read records, normalize into Canonical tables;
- Blocked: rename/delete Table, create/update/delete Field, change Primary field, write/update/delete records from our Worker or installer;
- Cutover ลูกค้าเปลี่ยนเฉพาะ Native connection/source account ไม่เปลี่ยน Physical table contract.

Repository บังคับ rule นี้ด้วย `packages/config/src/lark-table-governance.js` และ Generic Lark schema planner ต้อง Fail closed ด้วย `LARK_PROTECTED_TABLE_MUTATION_BLOCKED` เมื่อ Contract ใดพยายาม Target protected table.

## Physical table target

### Reuse/Rename in place — ไม่เพิ่ม Table

1. `RAW_TikTok_Business_Campaigns` → `RAW_Meta_Organic_Accounts`
2. `RAW_TikTok_Business_AdGroups` → `RAW_Meta_Organic_Content`
3. `RAW_TikTok_Business_Ads` → `RAW_Meta_Organic_Metrics`
4. `RAW_Google_Campaigns` → `RAW_Ads_Entities`
5. `RAW_Google_Customer_Lists` → `RAW_Ads_Daily`

การ Rename/Reuse อนุญาตได้ต่อเมื่อ Live Preview ยืนยัน Table เดิมยังมี 0 records และไม่มี Active dependency. เป็นการใช้ Table ID เดิม ไม่ใช่ย้ายข้อมูลข้าม Table.

### Create new — เพิ่มเฉพาะ Grain ที่ไม่มีจริง

1. `MKT_Account_Daily` — Account×Date; ไม่ควรปนกับ Content×Date.
2. `MKT_Ads_Ads` — Ad identity; ห้ามรวมกับ reusable Creative identity.

จำนวน Table เป้าหมายจึงเป็น 28 จาก 26 ปัจจุบัน ไม่ใช่ 41.

## Shared Raw model

### Meta Organic

- `RAW_Meta_Organic_Accounts`: Facebook Page และ Instagram account latest state.
- `RAW_Meta_Organic_Content`: Facebook Post/Reel/Video และ Instagram Media latest state.
- `RAW_Meta_Organic_Metrics`: Account/Content metric facts แบบ Entity×Metric×Source time.

### Paid Ads

- `RAW_Ads_Entities`: Meta/TikTok/Google account, campaign, ad group, ad, creative และ audience โดยใช้ `entity_type`.
- `RAW_Ads_Daily`: Entity×Date×Breakdown performance facts.

Platform/Entity-specific response data ที่ไม่ใช่ Shared query field เก็บใน redacted `source_payload_json`, `value_json`, `actions_json` หรือ `breakdown_json`.

## Existing operational tables

- `RAW_TikTok_Creator_Videos`: protected external source — retain.
- `RAW_YouTube_Channels`, `RAW_YouTube_Videos`, `RAW_YouTube_Analytics_Daily`: operational live tables — retain and do not merge in this revision.
- Canonical Organic, Ads, Report และ Reliability tables: retain; use Views by platform.

## Gates ก่อน Live schema action

1. Revised source contract and field dictionary pass review.
2. Read-only live inventory confirms 5 reuse candidates remain empty.
3. Protected table is resolved and reported as read-only, never as a write target.
4. Preview shows exactly five in-place rename/reconcile plans and two new tables; no unexpected create.
5. Existing TikTok Native, YouTube, Canonical, Report and System tables have no destructive action.
6. Apply requires explicit user authorization in a separate step.
7. Second Preview must be zero-drift before connector implementation begins.

No Live Lark mutation, connector implementation, API call, Cloudflare rollout, Ad creation or Spend is authorized by this architecture revision.

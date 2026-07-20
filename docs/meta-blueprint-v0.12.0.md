# Meta Organic + Meta Ads Blueprint v0.12.0

## Status

- Blueprint status: `draft_ready_for_review`
- Connector implementation: `blocked`
- Lark Apply: `not_started`
- External API preflight: `blocked_pending_credential_rotation`
- Production: `blocked_customer_owned_live_uat_required`

ไฟล์นี้เป็น Source Contract สำหรับตรวจทานก่อนเริ่ม Connector implementation. งานรอบนี้ไม่มีการเรียก Meta API, Apply Lark schema, ส่ง Queue, Deploy Worker, เปิด Schedule หรือแก้ Production.

## Scope

Blueprint ครอบคลุม 14 RAW tables:

### Facebook Organic

1. `RAW_Meta_Pages`
2. `RAW_FB_Page_Insights_Daily`
3. `RAW_FB_Posts`
4. `RAW_FB_Post_Insights_Daily`

### Instagram Organic

5. `RAW_IG_Accounts`
6. `RAW_IG_Account_Insights_Daily`
7. `RAW_IG_Media`
8. `RAW_IG_Media_Insights_Daily`

### Meta Ads

9. `RAW_Meta_Ad_Accounts`
10. `RAW_Meta_Campaigns`
11. `RAW_Meta_Ad_Sets`
12. `RAW_Meta_Ads`
13. `RAW_Meta_Ad_Creatives`
14. `RAW_Meta_Ads_Insights_Daily`

และเสนอ Canonical table ใหม่หนึ่งตาราง:

- `MKT_Accounts_Daily` — account/page daily snapshot ข้าม Facebook และ Instagram

ตารางใหม่นี้ยังเป็น Proposal และห้าม Apply จนผู้ใช้อนุมัติ.

## Canonical destinations

- Facebook Page / Instagram Account → `MKT_Accounts`
- Facebook Post / Instagram Media → `MKT_Content`
- Facebook Post / Instagram Media snapshots → `MKT_Content_Daily`
- Facebook Page / Instagram Account snapshots → `MKT_Accounts_Daily` (proposal)
- Meta Ad Account → `MKT_Ads_Accounts`
- Campaign → `MKT_Ads_Campaigns`
- Meta Ad Set → `MKT_Ads_AdGroups`
- Ad → `MKT_Ads_Ads`
- Creative → `MKT_Ads_Creatives`
- Aggregate daily Ads insight → `MKT_Ads_Daily`

## Stable-key contracts

```text
facebook_page_key = facebook:{logical_account_key}:{page_id}
facebook_post_key = facebook:{logical_account_key}:{post_id}
instagram_account_key = instagram:{logical_account_key}:{ig_user_id}
instagram_media_key = instagram:{logical_account_key}:{media_id}
organic_daily_key = {entity_key}:{source_metric_date}

meta_ads_entity_key = meta_ads:{ad_account_id}:{entity_type}:{external_entity_id}
meta_ads_daily_key = {entity_key}:{source_metric_date}
meta_ads_raw_breakdown_key = {entity_key}:{source_metric_date}:{breakdown_key}
```

Canonical Ads primary field names must match `packages/config/src/ads-data-model.js` exactly:

```text
MKT_Ads_Accounts   → ads_account_key
MKT_Ads_Campaigns  → ads_campaign_key
MKT_Ads_AdGroups   → ads_ad_group_key
MKT_Ads_Ads        → ads_ad_key
MKT_Ads_Creatives  → ads_creative_key
MKT_Ads_Daily      → ads_daily_key
```

Raw Meta Ads tables use the same canonical key names for their normalized stable-key fields. Parent relationship keys may remain RAW-only; Canonical destination tables receive their declared external ID fields such as `external_campaign_id`, `external_ad_group_id` and `external_creative_id`. Ad rows store the external Creative ID and never substitute an Ad ID for a Creative ID.

External IDs ที่ดูเหมือนตัวเลขต้องเก็บเป็น Text เสมอ. Stable key ต้อง account-scoped และห้ามเปลี่ยนตามชื่อ Account/Page/Campaign.

## Organic snapshot semantics

- Account/Page daily endpoint facts ใช้ `source_metric_date` ตาม Source timezone ที่อนุมัติ.
- Post/Media metrics หลายรายการเป็น cumulative/lifetime snapshot; ห้ามตีความเป็น daily delta โดยไม่มีหลักฐานครบสองวันที่ต่อเนื่อง.
- Empty dataset, unsupported metric และ permission-limited metric ใช้ `null`/N/A ไม่ใช่ `0`.
- Connector ต้องทำ capability detection และบันทึก `available_metrics_json`.
- Full reconciliation ไม่ลบ record; ใช้ `is_missing_candidate` และ `missing_since` พร้อม warning เมื่อ scope ตรวจครบ.

## Ads hierarchy and identity

```text
Ad Account → Campaign → Ad Set → Ad
                              ↘ Creative
```

Meta Ad Set map ไป Canonical `ad_group`. Ad กับ Creative เป็นคนละ Entity และต้องมี External ID/Stable key แยกกัน. ห้ามใช้ Ad ID เป็น Creative ID หรือกลับกัน.

## Ads daily grain and breakdowns

- Canonical `MKT_Ads_Daily` รับเฉพาะ aggregate row ที่ `breakdown_key=all`.
- Placement/device/publisher breakdown rows เก็บใน `RAW_Meta_Ads_Insights_Daily` เท่านั้น จนกว่าจะมี Canonical breakdown model แยก.
- Daily date ต้องยึด Ad Account timezone.
- Large result scope ต้องรองรับ async Insights job, bounded polling, timeout, retry และ durable resume.
- วันที่ยังอยู่ใน attribution lookback ต้องทำเครื่องหมาย `is_provisional=true` และอนุญาต restatement แบบ idempotent.

## Money contract

Source decimal amount ต้องเก็บ raw string ก่อน แล้ว parse โดยตรงเป็น integer micros:

```text
1 currency unit = 1,000,000 micros
```

ห้ามแปลง decimal string ผ่าน JavaScript floating point ก่อนสร้าง `spend_micros` หรือ `conversion_value_micros`.

Derived metrics:

```text
CTR = clicks / impressions
CPC = spend_micros / clicks / 1,000,000
CPM = spend_micros / impressions × 1,000 / 1,000,000
CPA = spend_micros / conversions / 1,000,000
Actual ROAS = conversion_value_micros / spend_micros
```

Zero denominator หรือ missing component ให้ผล `null`. `target_roas` ห้าม map เป็น `actual_roas`.

## Conversion and attribution contract

- `actions` และ `action_values` เก็บ RAW arrays แบบ sanitized.
- `conversions` และ `conversion_value_micros` ต้องเลือกจาก `META_ADS_PRIMARY_CONVERSION_ACTION` ที่ผู้ใช้/ลูกค้าอนุมัติ.
- ห้ามรวมทุก action type เป็น Conversion เดียว.
- `META_ADS_ACTION_REPORT_TIME` และ attribution/restatement lookback ต้องล็อกใน Customer profile หลัง Live payload review.

## Customer onboarding contract

เป้าหมายคือ Deploy ลูกค้าใหม่แบบ Config-only:

1. เลือก Customer profile
2. ใส่ non-secret Page/IG/Ad Account IDs และ Lark Table IDs
3. ใส่ App secret/token ใน Cloudflare Secret store
4. รัน identity/access/capability preflight
5. Preview/Apply Lark schema แบบ idempotent
6. Manual Full sync และ idempotent rerun
7. Reliability/large-account UAT
8. เปิด Schedule หลังทุก Gate ผ่าน

ห้ามเพิ่ม logic เฉพาะลูกค้า เช่น `if customer === chemistry_k`. Contract gap ที่พบระหว่าง Live UAT ต้องแก้ใน Core แบบ configurable และใช้ซ้ำได้.

## Ownership and security

- DEV ใช้ App/Page/Instagram/Ad account/Lark/Cloudflare ที่ผู้พัฒนาเป็นเจ้าของ.
- Production ต้องใช้ทรัพยากรที่ลูกค้าเป็นเจ้าของ และเชิญผู้พัฒนาเป็น Developer/Admin ตาม least privilege.
- App secret, User/Page/System User token ห้ามอยู่ใน Source, Lark business tables, D1 operational payload หรือ Log.
- Credential YouTube ที่เคยปรากฏในภาพต้อง Rotate ก่อน External API UAT/Deploy รอบถัดไป.

## Large-account targets

- Facebook: fixture อย่างน้อย 5,000 posts
- Instagram: fixture อย่างน้อย 2,000 media
- Meta Ads: async large Insights result ที่บังคับ page/poll/chunk resume

Production status ต้องผ่าน technical gates, large fixture และ customer-owned live UAT.

## Blueprint artifacts

สร้างจาก Task รอบนี้ใน working environment:

- `Social_MKT_Data_Hub_Meta_Blueprint_v0.12.0.xlsx`
- `Social_MKT_Data_Hub_Meta_Lark_Import_v0.12.0.xlsx`

ไฟล์ Excel ยังเป็น review/provisioning artifacts และไม่ได้ Commit ผ่าน GitHub connector. `docs/meta-blueprint-v0.12.0.md` และ `docs/current-task.md` เป็นข้อความ Source Contract ใน Repository.

## Approval gate

ก่อนเริ่ม Connector coding ผู้ใช้ต้องอนุมัติอย่างน้อย:

- Table inventory และ 371 field contracts
- `MKT_Accounts_Daily` proposal
- Daily vs lifetime snapshot semantics
- Ads aggregate vs breakdown handling
- Money micros contract
- Conversion action และ attribution policy
- Customer-profile config-only onboarding
- Access/ownership/UAT checklist

หลังอนุมัติให้เปลี่ยน `docs/current-task.md` เป็น `approved_for_implementation` แล้วค่อยเริ่ม Meta shared client/preflight/schema installer โดยคง Facebook, Instagram, Meta Ads และ Schedule เป็น disabled-by-default.

# Google Ads Manager Script External DRY_RUN — 2026-07-25

## Result

```text
AUTHORIZATION             = PASS
SCRIPT_MODE               = DRY_RUN
DELIVERY_ENABLED          = FALSE
ADSAPP_GAQL               = SIX_DATASETS_PASS
URLFETCHAPP               = NOT_CALLED
SIGNED_INGRESS            = DISABLED
GOOGLE_ADS_CHANGES        = NONE
QUEUE_LARK_BUSINESS_WRITE = ZERO
SCHEDULE_LIVE_PRODUCTION  = DISABLED
```

การตรวจนี้รันจาก Google Ads Manager Script จริงภายใต้ Manager ที่ได้รับสิทธิ์
และเลือก exact allowlisted Advertiser ผ่าน Script Properties เดิม. หลักฐานนี้
เก็บเฉพาะผลแบบ sanitized; ไม่มี Customer ID, account name, user identity,
Secret, Token หรือ raw row อยู่ใน Repository

## Authorization validation

Google Ads เปิด Script editor และเริ่ม Preview ได้โดยไม่ขอ Authorization ใหม่.
จึงยืนยันว่า Authorization ของ Script ยังใช้งานได้ในรอบนี้. Google ระบุว่า
Script จะขออนุญาตอัตโนมัติเมื่อรันครั้งแรกหรือเมื่อ Authorization หมดอายุ;
การตรวจรอบนี้ไม่เปลี่ยน Google account permission

## Compatibility corrections

External DRY_RUN แรก fail closed ที่:

```text
asset.status = UNRECOGNIZED_FIELD
```

Resource `asset` ไม่มี selectable status; status ของ `customer_asset` หรือ
`campaign_asset` เป็นคนละ Linkage grain. Script จึงตัด field นี้จาก GAQL และ
คง output `youtubeAssets.status=null`

รอบถัดมา fail closed ที่ชื่อ metric รุ่นเก่า:

```text
metrics.video_views
metrics.video_view_rate
metrics.average_cpv
```

Script และ manifest ถูก pin ที่ Google Ads API `v24` และเปลี่ยนเป็น:

```text
metrics.video_trueview_views
metrics.video_trueview_view_rate
metrics.trueview_average_cpv
```

Output contract กลางยังคง:

```text
videoViews
videoViewRate
averageCpvMicros
```

## Final sanitized evidence

```text
duration_seconds            = 59
account_rows                = 1
campaign_rows               = 58
ad_group_rows               = 110
ad_rows                     = 760
youtube_asset_rows          = 161
campaign_daily_metric_rows  = 287
planned_chunks              = 7
truncated                   = false
Google Ads changes          = No changes
```

Logger summary ยืนยัน `mode=DRY_RUN` และ `deliveryEnabled=false`. Code path
คืนผลก่อน `deliverSignedChunk_()` ดังนั้นไม่มี `UrlFetchApp`, HMAC delivery,
Worker ingress หรือ Secret requirement

## Source evidence

```text
artifact = scripts/google-ads-manager-script-signed-delivery.js
sha256   = 947b0bf3062cf4c6836e5b3101e36896340ffb0e83f9d2ba29459ae2d0b8a509
manifest = docs/google-ads-manager-script-gaql-manifest-v1.json
```

Google Ads Script source ถูกอัปเดตเป็น sanitized artifact เดียวกับ Repository.
Script Properties เดิมไม่ได้ถูกแสดงหรือแก้ และ source ไม่มี Customer ID/Secret

## Safe state and remaining gate

- Signed ingress ยังคงปิด
- ไม่มี Secret provisioning
- ไม่มี Queue message
- ไม่มี D1/Lark Business write
- ไม่มี Schedule/LIVE/Production
- Signed PREVIEW delivery ยังไม่รัน
- One-time Signing Secret provisioning อยู่ที่ Design-only และยังไม่มี
  Migration/Endpoint/Deploy

ขั้นถัดไปต้อง Review local Design และขอ Approval แยกก่อนสร้าง implementation
ของ one-time Ticket provisioning

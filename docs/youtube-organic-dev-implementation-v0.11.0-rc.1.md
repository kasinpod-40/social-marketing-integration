# YouTube Organic DEV Implementation — v0.11.0-rc.1

## Purpose

รุ่นนี้เปลี่ยน YouTube Organic จาก Blueprint-only foundation ไปเป็น Manual DEV UAT implementation โดยยัง Fail-closed สำหรับ Schedule และ Production.

## Runtime gates

Manual Queue route จะทำงานเมื่อครบทุกเงื่อนไข:

```text
job.type = youtube.channel.organic.sync
job.trigger = manual_uat
MKT_CONNECTOR_YOUTUBE_UAT_ENABLED = true
MKT_CONNECTOR_YOUTUBE_ENABLED = false
connector implementationStatus = uat_pending
```

หาก Normal connector flag ถูกเปิดก่อนสถานะ `active`, runtime config จะปฏิเสธ. ไม่มี Scheduler producer สำหรับ YouTube ในรุ่นนี้.

## Data flow

```text
YouTube channels.list
→ RAW_YouTube_Channels
→ MKT_Accounts (write last)

Uploads playlist → playlistItems.list → videos.list
→ RAW_YouTube_Videos
→ MKT_Content
→ MKT_Content_Daily (cumulative snapshot)

Optional OAuth owner reports.query
→ RAW_YouTube_Analytics_Daily (RAW-only Phase 1)
```

ทุก Destination table ถูก Plan/Schema-preflight ก่อน Write ตารางแรก. `MKT_Accounts.connection_status=connected` ถูกเขียนเป็นลำดับสุดท้ายหลัง RAW และ Canonical writes สำเร็จ.

## Schema commands

Preview เป็น Read-only:

```bash
npm run setup:youtube-schema
```

Apply ต้องยืนยันสองชั้น:

```bash
CONFIRM_WRITE=YES npm run setup:youtube-schema:apply
```

Installer derive Field contract จาก `YOUTUBE_LARK_BLUEPRINT`, สร้างเฉพาะ 3 RAW tables, ไม่ลบ Table/Field/Record เดิม และ Fail-closed เมื่อ Field type ชน.

## Access preflight

```bash
npm run preflight:youtube
```

Public checks:

- Channel ID ตรง allowlist
- `contentDetails.relatedPlaylists.uploads` มีค่า
- Playlist traversal คืน Video IDs
- Sample `videos.list` ทุกแถวอ้าง Channel เดียวกัน

Optional Owner Analytics checks:

- OAuth `mine=true` คืน Channel เดียวกับ allowlist
- Minimal `day,video` query ใช้ date range ที่ระบุ
- Headers ตรง approved contract

Placeholder Channel ID/Table ID/API key/OAuth credential ถูกปฏิเสธก่อน External request.

## Incremental and reconciliation

- Initial/no checkpoint → Full traversal
- Normal run → Recent upload window ตาม `MKT_YOUTUBE_RECENT_VIDEO_LIMIT`
- Full reconciliation ตาม `MKT_YOUTUBE_FULL_RECONCILIATION_INTERVAL_MS`
- Checkpoint เก็บ cursor และ source fingerprints ใน D1
- Video ที่เคยเห็นแล้วแต่หายจาก traversal ถูกคง RAW row และ Metrics เดิม
- Video ID ที่ Playlist คืนแต่ `videos.list` ไม่คืนรายละเอียด จะสร้าง/แก้ reconciliation row ที่มี Required identity fields ครบ
- Missing state ไม่เติม Metrics เป็นศูนย์และไม่ลบข้อมูล
- Successful run ที่มี missing videos บันทึก Warning ใน Sync Log และเปิด System Alert ระดับ warning

## Analytics

Owner Analytics เปิดแยกด้วย:

```text
MKT_YOUTUBE_ANALYTICS_ENABLED=true
```

ต้องมี OAuth owner client และ job ต้องกำหนด `analyticsStartDate`/`analyticsEndDate`.

Contract:

```text
ids=channel==CHANNEL_ID
dimensions=day,video
sort=day,video
filters=video==...
maxResults=200
startIndex += returned rows
```

Video IDs แบ่ง batch 50. Response headers ต้องตรง Contract ก่อน persist. ไม่มีการสร้าง Video×Day แถวศูนย์เมื่อ API ไม่คืน row. Period facts ยังไม่เขียนเข้า cumulative `MKT_Content_Daily`.

## Manual Queue payload

สร้าง Payload ตัวอย่าง:

```bash
npm run job:youtube-uat
```

ตัวอย่าง:

```json
{
  "schemaVersion": 1,
  "type": "youtube.channel.organic.sync",
  "trigger": "manual_uat",
  "syncMode": "auto",
  "metricDate": "2026-07-15",
  "dryRun": false
}
```

## Reliability

Route ใช้ Reliability layer เดิม:

- D1 Sync Log
- Lease lock และ renewal guard ก่อน External/write chunks
- Error classification และ bounded Queue retry
- Terminal/permanent failure → DLQ + System Alert
- Partial/unknown write → `partial_success` + critical alert
- Reconciliation warning หลัง success → warning alert
- Account write last ลด false-connected state

## Live UAT checklist

1. Public preflight
2. Optional Owner Analytics preflight
3. Schema Preview
4. Guarded Schema Apply
5. First Full sync
6. Idempotent rerun
7. Recent-window incremental update
8. Periodic/manual Full reconciliation
9. Playlist ID present but Video resource unavailable
10. Previously observed Video disappears
11. Channel identity mismatch
12. Quota exhaustion terminal behavior
13. Rate-limit/server bounded retry
14. Lock collision and retry
15. Retry exhaustion → DLQ/System Alert
16. Verify RAW, Canonical, Account and Sync Log rows in Lark
17. Keep Schedule disabled throughout UAT

## Activation rule

Do not change `uat_pending` to `active` until all Live UAT gates pass. Schedule design/activation is a separate task and Production must use customer-owned Lark, Cloudflare, Google project/OAuth credentials and YouTube assets.

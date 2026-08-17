# 00 — Current State

## Authority — 2026-08-17 final repository closeout

Current operational authority is `docs/current-task.md`.

```text
INTEGRATION_WORKSPACE               = ACTIVE_VERIFIED
REPOSITORY_CLOSEOUT                 = COMPLETE
REPOSITORY_CLOSEOUT_CODE_MERGE      = c1203cd3d96be7ae9616adad08d8c6b64d8b3cfe
AUTOMATIC_WEEKLY_NOTIFICATION       = LIVE_ENABLED_MONDAY_0830_ASIA_BANGKOK
WEEKLY_V6_CONTROLLED_RECOVERY       = PASS_EXACTLY_ONCE
NEXT_SCHEDULED_EVIDENCE             = 2026-08-24 08:30 ASIA_BANGKOK
OPEN_PULL_REQUESTS                  = PR_220_ONLY
TIKTOK_ADS                          = DEFERRED_BY_USER
PRODUCTION                          = BLOCKED_CUSTOMER_OWNED
DLQ_REDRIVE                         = BLOCKED_OFF
```

Facebook, Instagram, TikTok Organic, YouTube, Meta Ads, Google Ads, WooCommerce และ Chatwoot อยู่ใน Integration runtime/report architecture ปัจจุบันแล้ว. Non-TikTok Lark RAW retirement ปิดแล้วและ `RAW_TikTok_Creator_Videos` ยังคง protected/read-only. TikTok Organic `MKT_Accounts` master ครบ 4 Organic channels.

Repository debt จาก stale PR #249 ปิดผ่าน PR #658 และ obsolete Draft PR #11/#17/#66/#249/#595 ถูกปิดแล้ว. Open PR เหลือ #220 TikTok Ads เพียงตัวเดียวตามคำสั่งผู้ใช้.

Weekly v6 controlled recovery ผ่าน Quality Gate, D1 delivery และ Lark Notification exactly once แล้ว แต่ schedule proof ต้องมาจาก Automatic Weekly รอบถัดไปตามเวลาจริงเท่านั้น; ห้ามใช้ manual/control run แทน.

TikTok Ads เป็นงาน deferred และไม่ใช่ blocker ของ repository closeout รอบนี้. Production เป็น customer-owned boundary แยกต่างหาก.

State เดิมก่อน closeout ถูกเก็บ byte-for-byte ที่ `docs/project-brain/archive/00-current-state-pre-closeout-2026-08-17.md`.

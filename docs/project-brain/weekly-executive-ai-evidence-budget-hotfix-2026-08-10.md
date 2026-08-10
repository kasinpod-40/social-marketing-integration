# Weekly Executive AI Evidence Budget Hotfix — 2026-08-10

## Incident

หลัง Multichannel Daily materialization สำเร็จครบ 32/32 สำหรับ period end `2026-08-09`, Fresh Weekly Executive Decision Preview เลือกช่วง `2026-08-03..2026-08-09` ได้แล้ว แต่หยุดที่ `build-fresh-period-authority` ก่อน mutation:

```text
code                 LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED
observedChars        8435
maximumChars         8000
recordWriteCount     0
triggerWriteCount    0
queueAdmissionCount  0
messageSendCount     0
scheduleActivation   0
production           BLOCKED
```

## Root cause

`build-lark-weekly-executive-full-channel-ai-evidence.js` เก็บ ranked candidates ไว้ถูกต้องใน `contentCandidates` และ `adCandidates` สูงสุด 3 รายการต่อ channel แต่ยัง serialize candidate อันดับ 1 ซ้ำอีกครั้งผ่าน AI-side aliases `topContent` และ `topAds`.

Aliases เหล่านี้ไม่จำเป็นต่อ current Decision Quality Gate: candidate-name validation, Scale evidence, Funnel divergence, CTR facts และ cross-channel facts ใช้ ranked candidate collections โดยตรงแล้ว.

## Fix

ลบเฉพาะ AI-side duplicate aliases ออกจาก `channelBusinessEvidence`:

```text
contentCandidates  retained
adCandidates       retained
topContent         removed from AI evidence only
topAds             removed from AI evidence only
```

ไม่แก้ factual-report compatibility aliases, ไม่ลด candidate count, ไม่เพิ่มเพดาน `MAX_METRIC_SUMMARY_CHARS=8000`, ไม่ลด Quality Gate และไม่แก้ Historical Weekly identity/delivery.

## Safety

Repository hotfix นี้ทำ Remote action = 0. Notification Runtime, Automatic Weekly Notification และ Production ยังคง OFF/BLOCKED. เพราะ live failure เดิมหยุดก่อน trigger จึงอนุญาตให้ Fresh Preview `--execute` ใหม่หนึ่งครั้งได้เฉพาะหลัง PR นี้ merge และ exact-current-main verification ผ่าน.

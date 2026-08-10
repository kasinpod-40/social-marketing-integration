# Weekly Executive AI Evidence Budget Hotfix — 2026-08-10

## Incident 1 — legacy rank-1 aliases

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

### Root cause

`build-lark-weekly-executive-full-channel-ai-evidence.js` เก็บ ranked candidates ไว้ถูกต้องใน `contentCandidates` และ `adCandidates` สูงสุด 3 รายการต่อ channel แต่ยัง serialize candidate อันดับ 1 ซ้ำอีกครั้งผ่าน AI-side aliases `topContent` และ `topAds`.

Aliases เหล่านี้ไม่จำเป็นต่อ current Decision Quality Gate: candidate-name validation, Scale evidence, Funnel divergence, CTR facts และ cross-channel facts ใช้ ranked candidate collections โดยตรงแล้ว.

### Fix — PR #586

ลบเฉพาะ AI-side duplicate aliases ออกจาก `channelBusinessEvidence`:

```text
contentCandidates  retained
adCandidates       retained
topContent         removed from AI evidence only
topAds             removed from AI evidence only
```

ไม่แก้ factual-report compatibility aliases, ไม่ลด candidate count, ไม่เพิ่มเพดาน `MAX_METRIC_SUMMARY_CHARS=8000`, ไม่ลด Quality Gate และไม่แก้ Historical Weekly identity/delivery.

## Incident 2 — duplicate flattened candidate collections

หลัง PR #586 merge และ rerun exact current main, Fresh Preview เดิมหยุดก่อน mutationอีกครั้ง:

```text
code                 LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED
observedChars        8220
maximumChars         8000
recordWriteCount     0
triggerWriteCount    0
queueAdmissionCount  0
messageSendCount     0
scheduleActivation   0
production           BLOCKED
```

### Root cause

Ranked `contentCandidates` และ `adCandidates` ที่อยู่ครบแล้วใน `channelBusinessEvidence` ถูก flatten และ serialize ซ้ำทั้ง collection อีกครั้งภายใต้ `decisionEvidence` ของ `metricSummaryJson` เดียวกัน.

`decisionEvidence` ไม่จำเป็นต้องถือ candidate objects ซ้ำ เพราะ Native AI อ่าน candidate facts จาก `channelBusinessEvidence` อยู่แล้ว ขณะที่ decision-specific metadata ที่ต้องคงไว้มีเพียง:

```text
scaleEvidenceAdNames
funnelDivergences
organicPaidMappingAvailable
```

Candidate names สำหรับ deterministic output validation ยังคง derive แยกใน non-persisted validation evidence และ Quality Gate เดิมไม่เปลี่ยน.

### Fix — PR #587

ลบเฉพาะ `decisionEvidence.contentCandidates` และ `decisionEvidence.adCandidates` ที่ซ้ำ โดยคง:

```text
channelBusinessEvidence.*.contentCandidates  retained up to 3 per channel
channelBusinessEvidence.*.adCandidates       retained up to 3 per channel
scaleEvidenceAdNames                         retained
funnelDivergences                            retained
organicPaidMappingAvailable                  retained
MAX_METRIC_SUMMARY_CHARS                     retained at 8000
Decision Quality Gate                        unchanged
```

Regression บังคับว่า ranked candidates ยังครบใน per-channel evidence, duplicate candidate collections ต้องไม่มีใน `decisionEvidence`, และ Scale/Funnel metadata ต้องยังอยู่ครบ.

## Safety

ทั้งสอง live failures หยุดก่อน record/trigger mutation. Repository hotfixes ทำ Remote action = 0. Notification Runtime, Automatic Weekly Notification และ Production ยังคง OFF/BLOCKED. เพราะ Incident 2 มี `recordWriteCount=0` และ `triggerWriteCount=0`, Fresh Preview `--execute` ใหม่หนึ่งครั้งทำได้เฉพาะหลัง PR #587 merge และ exact-current-main verification ผ่าน.

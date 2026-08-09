# Current Task — Weekly Executive Decision Report v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_IN_PROGRESS
CURRENT_PROGRAM                     = WEEKLY_EXECUTIVE_DECISION_REPORT_V1
BRANCH                              = work/executive-decision-report-v1
EXACT_BASE                          = af5ab29aed7d355aee788cc1a5a556f6afb731c7
AUTOMATIC_WEEKLY_NOTIFICATION       = BLOCKED_PENDING_DECISION_QUALITY
SCHEDULE_ACTIVATION                 = 0
PRODUCTION                          = BLOCKED
```

## Objective

ยกระดับ Weekly 7D Full-channel Report จากการสรุปตัวเลขเป็น Executive Decision Report ที่ช่วยผู้บริหารตัดสินใจได้จริง โดยใช้ Shared Report, Lark Native AI และ Notification path เดิมทั้งหมด

รายงานต้องตอบให้ได้จากหลักฐานที่มีว่า:

- ธุรกิจโดยรวมดีขึ้นหรือแย่ลงตรงไหน;
- Content ไหนเป็นตัวเด่นและควรทำซ้ำ/ต่อยอด/นำไป Paid Test;
- Paid Ad/Creative ไหนควร Scale, Test, Keep, Reduce หรือ Stop;
- upper funnel เช่น Impressions/Reach/Views ไปสวนทางกับ Clicks/Conversion/Sales หรือไม่;
- อะไรยังไม่มีหลักฐานเพียงพอและจึงห้ามแนะนำเพิ่มงบ;
- สัปดาห์หน้าผู้บริหารควรตัดสินใจทำอะไรเป็นลำดับแรก.

## Root cause confirmed from repository

Source collector เดิมอ่านข้อมูลที่จำเป็นต่อการตัดสินใจอยู่แล้ว แต่ factual/AI boundary ลดทอนข้อมูลก่อนถึง Native AI:

- `MKT_Report_Top_Content` ถูกลดเหลือ Content อันดับ 1 เพียงรายการเดียว;
- `MKT_Report_Top_Ads` ถูกลดเหลือ Ad อันดับ 1 เพียงรายการเดียว;
- Content likes/comments/shares และ Paid conversion value/CPC/CPA/ROAS ถูกทิ้ง;
- AI writer contract เดิมกำหนด Recommendation เพียง business action จาก facts จึงยอมให้คำแนะนำกว้าง ๆ ผ่าน Quality Gate;
- ไม่มี exact Organic↔Paid creative mapping ใน source ปัจจุบัน ดังนั้นห้ามอ้างว่า Organic post และ Paid creative เป็นชิ้นเดียวกันโดยไม่มีหลักฐาน.

## In scope

### Factual authority

- ขยาย factual shape เดิม ไม่สร้าง Report engine ใหม่;
- เก็บสูงสุด 5 Content candidates และ 5 Ads candidates ต่อช่องทางจาก retained Shared Report output;
- รักษา `topContent` / `topAd` aliases เพื่อ backward compatibility;
- เก็บ decision metrics ที่ source มีอยู่แล้ว:
  - Organic: Views, Likes, Comments, Shares, Engagement, Engagement Rate, Performance status;
  - Paid: Spend, Impressions, Reach, Clicks, derived CTR, Conversions, Conversion Value, CPC, CPA, ROAS;
- Notification factual section แสดง Top 3 candidates แบบ bounded.

### AI decision evidence

- ส่งสูงสุด 3 Content และ 3 Ads candidates ต่อช่องทางเข้า Native AI;
- รักษา signal-aware metric selection เดิม;
- สร้าง deterministic funnel divergence เมื่อ awareness metric เพิ่ม แต่ action/commerce metric ลด;
- ระบุชัดว่า `organicPaidMappingAvailable=false` จนกว่าจะมี exact mapping contract.

### Executive decision contract

Recommendation ต้องเป็น 2-5 actions และใช้ label ที่ชัดเจน:

```text
[CONTENT]   ทำซ้ำ/ต่อยอด Content จาก Organic evidence
[TEST]      ทดลองแบบจำกัดงบเมื่อ evidence ยังไม่ถึง Scale
[SCALE]     เพิ่มงบเฉพาะ candidate ที่มี lower-funnel evidence
[KEEP]      คงไว้และติดตาม
[REDUCE]    ลดงบ/ลดน้ำหนัก
[STOP]      หยุดเมื่อ evidence รองรับ
[NO-SCALE]  ห้ามเพิ่มงบในภาพรวมเมื่อ Funnel สวนทางหรือ evidence ไม่พอ
```

ทุก action ต้องอ้างชื่อ Content/Ad จริงเมื่อมี candidate และต้องผูกกับ business fact ที่สังเกตได้.

### Scale safety

- CTR/Impressions/Reach อย่างเดียวไม่เพียงพอสำหรับ `[SCALE]`;
- Organic winner อย่างเดียวให้เสนอ `[TEST]`, ห้ามสรุปว่าจะ Paid winner;
- `[SCALE]` ต้องมี Conversion evidence และ ROAS/Conversion Value + Spend evidence;
- ถ้า awareness เพิ่มแต่ Clicks/Conversions/Sales/Revenue ลด ต้องมี Funnel warning และห้าม broad scale;
- ห้าม fabricate Organic↔Paid linkage.

## Out of scope

- ห้าม rerun/resend/replace historical Weekly Notification identity ที่ส่งแล้ว;
- ห้าม Trigger Native AI ของ historical identity;
- ห้าม Queue send หรือ Lark Group send;
- ห้าม Activate Base Notification Automation;
- ห้ามเปิด automatic Notification producer;
- ห้ามเปิด Source/Report Schedule;
- ห้าม Deploy Worker หรือแก้ Production;
- ห้ามสร้าง external AI provider หรือ AI runtime ใหม่;
- exact Organic↔Paid content mapping schema เป็น future extension หาก source มี identity ที่เชื่อถือได้.

## Acceptance criteria

- Factual report เก็บ candidate หลายอันดับโดยไม่เสีย metric ที่ใช้ตัดสินใจ;
- AI evidence มี Content/Ad candidates และ lower-funnel metrics ที่ source รองรับ;
- Generic recommendation แบบ `ทบทวน/ติดตาม/วิเคราะห์ต่อ` โดยไม่มี explicit decisions ต้อง fail Quality Gate;
- เมื่อมี Content candidates ต้องมี named `[CONTENT]`/`[TEST]` action;
- เมื่อมี Paid candidates ต้องมี named paid action;
- `[SCALE]` ที่ไม่มี conversion/value/ROAS evidence ต้อง fail;
- Funnel divergence ต้องถูกกล่าวถึงเมื่อ evidence พบ awareness-up/outcome-down;
- fabricated Organic↔Paid identity ต้อง fail;
- existing null/zero, currency micros, derived CTR, signal and internal-language guards ต้องยังผ่าน;
- Historical delivered identity ไม่ถูกเปลี่ยนหรือส่งซ้ำ;
- Automation/Schedule/Production ยังคง blocked;
- Full repository gates และ exact PR-head CI ต้องผ่านก่อน Merge.

## Required tests

```bash
npm ci
npm run check
node --test tests/application/lark-weekly-executive-factual-report.test.js
node --test tests/application/lark-weekly-executive-full-channel-ai-evidence.test.js
node --test tests/application/lark-weekly-7d-full-channel-ai-synthesis.test.js
node --test tests/application/lark-weekly-7d-full-channel-notification.test.js
node --test tests/scripts/lark-weekly-7d-full-channel-ai-synthesis-source.test.mjs
node --test tests/scripts/lark-weekly-7d-full-channel-notification-source.test.mjs
npm test
npm run test:report-reliability
npm audit --audit-level=high
npm run deploy:dry-run
git diff --check
```

## Implementation result

```text
Factual decision candidates        IMPLEMENTED / VERIFICATION_PENDING
AI decision evidence               IMPLEMENTED / VERIFICATION_PENDING
Executive decision quality gate    IMPLEMENTED / VERIFICATION_PENDING
Historical notification mutation   0
Native AI trigger                  0
Queue / Group send                 0
Automation activation              0
Schedule activation                0
Production                         BLOCKED
PR / CI / Merge                    PENDING
```

# Current Task — Weekly Executive Decision Report v1

## Status

```text
TASK_STATUS                         = IMPLEMENTATION_COMPLETE_CODE_CI_PASS
CURRENT_PROGRAM                     = WEEKLY_EXECUTIVE_DECISION_REPORT_V1
BRANCH                              = work/executive-decision-report-v1
EXACT_BASE                          = af5ab29aed7d355aee788cc1a5a556f6afb731c7
VERIFIED_CODE_HEAD                  = 7abf93cd65b30740bbea1a60478fc3104254e258
BRANCH_VERIFICATION_RUN             = 31326928185
BRANCH_VERIFICATION_JOB             = 93278674827
AUTOMATIC_WEEKLY_NOTIFICATION       = BLOCKED_PENDING_FRESH_DECISION_PREVIEW
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

## Implemented contract

### Factual authority

- ขยาย factual shape เดิม ไม่สร้าง Report engine ใหม่;
- เก็บสูงสุด 5 Content candidates และ 5 Ads candidates ต่อช่องทางจาก Shared Report output;
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
- `[NO-SCALE]` ไม่ถูกตีความเป็น Scale จากคำว่า “ไม่เพิ่มงบ”;
- ห้าม fabricate Organic↔Paid linkage.

## Out of scope / locked safety

- ห้าม rerun/resend/replace historical Weekly Notification identity ที่ส่งแล้ว;
- ห้าม Trigger Native AI ของ historical identity;
- ห้าม Queue send หรือ Lark Group send;
- ห้าม Activate Base Notification Automation;
- ห้ามเปิด automatic Notification producer;
- ห้ามเปิด Source/Report Schedule;
- ห้าม Deploy Worker หรือแก้ Production;
- ห้ามสร้าง external AI provider หรือ AI runtime ใหม่;
- exact Organic↔Paid content mapping schema เป็น future extension หาก source มี identity ที่เชื่อถือได้.

## Acceptance result

- Factual report เก็บ candidate หลายอันดับและ decision metrics: PASS
- AI evidence มี Content/Ad candidates และ lower-funnel metrics: PASS
- Generic recommendation แบบเดิมไม่มี explicit decisions: BLOCKED BY TEST
- Named Content action เมื่อมี Content candidate: ENFORCED
- Named Paid action เมื่อมี Ad candidate: ENFORCED
- Unsupported `[SCALE]`: BLOCKED
- Funnel divergence awareness-up/outcome-down: ENFORCED
- Fabricated Organic↔Paid identity: BLOCKED
- null/zero, currency micros, derived CTR, signal/internal-language guards: PRESERVED
- Historical delivered identity mutation/send: 0
- Automation/Schedule/Production: BLOCKED

## Exact code-head verification

Branch Verification run `31326928185`, job `93278674827`, exact code Head
`7abf93cd65b30740bbea1a60478fc3104254e258` passed every repository gate:

```text
Install locked dependencies                 PASS
Syntax architecture and hygiene             PASS
Focused Report source readiness             PASS
Focused Meta history finalizer              PASS
Focused Woo race recovery                   PASS
Focused Chatwoot final UAT                   PASS
Focused staged TikTok                       PASS
Unit and Workers runtime                    PASS
Report reliability regression               PASS
Dependency audit                            PASS
Wrangler dry run                            PASS
Diff whitespace check                       PASS
Diagnostics upload                          PASS
```

Any documentation-only commit after this code Head still requires exact final PR-head CI before Merge.

## Implementation result

```text
Factual decision candidates        IMPLEMENTED / CODE CI PASS
AI decision evidence               IMPLEMENTED / CODE CI PASS
Executive decision quality gate    IMPLEMENTED / CODE CI PASS
Historical notification mutation   0
Native AI trigger                  0
Queue / Group send                 0
Worker deployment                  0
Automation activation              0
Schedule activation                0
Production                         BLOCKED
PR                                  #578 / DRAFT UNTIL FINAL HEAD CI
Next live gate                     FRESH FUTURE-PERIOD DECISION PREVIEW
```

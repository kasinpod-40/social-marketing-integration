# Lark Weekly 7D Full-channel AI Synthesis v1

## Objective

แก้ Weekly Executive Notification ให้ factual body และ AI synthesis ใช้ factual authority ชุดเดียวกันครบทุกช่องทางที่มี business facts โดยไม่แก้ accepted V9 source และไม่เปิด Automatic Notification.

## Confirmed live evidence

Read-only full-channel preview ของ retained period `2026-07-25..2026-07-31` ยืนยัน:

- 9 channel sections ถูก render ครบ;
- business facts มีจริง 4 channels: Facebook Organic, Instagram Organic, Meta Ads, WooCommerce;
- AI outputs ที่ใช้อยู่ยังมาจาก retained V9 Meta-only evidence จึงไม่สอดคล้องกับ factual body ที่มี comparison แล้ว;
- persisted `change_percent` เป็น ratio contract ขณะที่ notification renderer เดิมแสดงค่าดังกล่าวเป็น percentage point ตรง ๆ ทำให้ `0.07` ถูกแสดงเป็น `0.07%` แทนประมาณ `7%`.

## Correction

1. Factual report shape ขยับเป็น `executive_notification_full_channel_v3`.
2. Comparison presentation derive percentage point จาก canonical `current_value` และ `compare_value`; `change_percent` ใช้เป็น fallback ratio เท่านั้นและต้องคูณ 100 ตอนแสดง.
3. เพิ่ม compact full-channel AI evidence `lark_ai_full_channel_synthesis_v1`:
   - 9 channel identities;
   - business facts เฉพาะช่องที่ observed จริง;
   - สูงสุด 2 metrics ต่อ business channel;
   - currency micros presentation-scaled;
   - comparison เป็น percentage point;
   - raw CTR ไม่ authoritative; Top Ad CTR มาจาก clicks/impressions;
   - budget metric summary 2,800 chars และ status vector 700 chars.
4. สร้าง synthesis AI Run identity ใหม่จาก immutable V9 + factual checksum + evidence checksum.
5. ใช้ Native `AI-generated text` Automation เดิม โดยสร้าง preview row `generation_status=pending` แล้ว trigger เฉพาะ `failure_code` หนึ่ง field.
6. Synthesis row ต้องคง `preview_mode=true`, `notification_eligible=false`, `sent_to_group=false`.
7. Cross-channel quality gate บังคับ:
   - เมื่อมี business facts หลายช่อง Summary ต้องกล่าวอย่างน้อย 2 observed channels;
   - ถ้ามี positive comparison จริง Strengths ห้ามใช้ no-comparison fallback;
   - ถ้ามี negative comparison จริง Weaknesses ห้ามใช้ no-negative fallback;
   - existing internal-status, action leakage, fabricated metric และ CTR consistency gates ยังใช้ต่อ.
8. Corrected Notification identity v2 ต้องอ้าง generated synthesis row ที่ exact factual identity และ quality gate ผ่านเท่านั้น; ห้าม fallback กลับ retained V9 outputs.

## Safety

- accepted V9 source immutable;
- AI synthesis operator ไม่มี external GPT/API provider;
- Base Notification Automation ต้อง inactive;
- synthesis step ส่ง Notification 0;
- corrected Notification ยังต้องผ่าน read-only preview ก่อน execute;
- Queue one-shot / D1 atomic dedupe / Lark mirror path เดิมไม่เปลี่ยน;
- Automatic Notification producer และ Schedule ยังไม่เปิด;
- Production `BLOCKED`.

## Required verification

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
npm audit
npm run deploy:dry-run
git diff --check
```

`docs/current-task.md` intentionally remains untouched because it belongs to the active Chatwoot workstream.

import assert from 'node:assert/strict';
import test from 'node:test';

import { assertLarkWeeklyRecommendationsPromptDefinition } from '../../scripts/lib/lark-weekly-recommendations-live-prompt.js';

const APPROVED = `หน้าที่ของฟิลด์นี้:
- ถ้า metric_summary_json มี rb=[...] ให้ถือ rb เป็นคำตอบ Recommendations ที่เตรียมจากหลักฐานแล้ว และกฎ rb นี้มี authority สูงสุดเหนือกฎ Recommendations ข้ออื่นทั้งหมด
- เมื่อมี rb ให้ตอบเฉพาะข้อความของสมาชิก rb ตามลำดับ สมาชิกละหนึ่งบรรทัด และจำนวนบรรทัดต้องเท่ากับจำนวนสมาชิก rb พอดี
- ต้องคัดลอกข้อความภายในสมาชิก rb ตรงทุกตัวอักษร ห้ามแก้คำ ย่อ เพิ่ม ตัด สลับ แปล รวมบรรทัด paraphrase หรือสร้าง action เพิ่ม
- เมื่อมี rb ห้ามใช้กฎ fallback ด้านล่างเพื่อแต่งคำใหม่; กฎที่เหลือต่อไปนี้ใช้เฉพาะเมื่อไม่มี rb`;

test('verifies the approved rb prompt authority from a hydrated workflow without returning prompt text', () => {
  const result = assertLarkWeeklyRecommendationsPromptDefinition({
    workflow_id: 'wkfAI12345',
    steps: [{
      type: 'AI-generated text',
      data: { prompt: APPROVED, output_field: 'recommendations' },
    }],
  });
  assert.deepEqual(result, {
    verified: true,
    matchedAnchorCount: 5,
    requiredAnchorCount: 5,
  });
  assert.equal(JSON.stringify(result).includes('metric_summary_json'), false);
  assert.equal(JSON.stringify(result).includes('prompt'), false);
});

test('accepts prompt text split across hydrated rich-text leaves', () => {
  const pieces = APPROVED.split(/\n/u).map((text) => ({ text }));
  const result = assertLarkWeeklyRecommendationsPromptDefinition({ steps: [{ config: { pieces } }] });
  assert.equal(result.verified, true);
  assert.equal(result.matchedAnchorCount, 5);
});

test('blocks the stale pre-rb recommendations prompt without exposing its contents', () => {
  assert.throws(
    () => assertLarkWeeklyRecommendationsPromptDefinition({
      steps: [{ data: { prompt: 'เขียน 2–4 action สั้น ๆ โดยหนึ่ง action ต่อหนึ่งบรรทัด' } }],
    }),
    (error) => {
      assert.equal(error.code, 'LARK_WEEKLY_7D_EXECUTIVE_DECISION_LIVE_PROMPT_MISMATCH');
      assert.deepEqual(error.details, { matchedAnchorCount: 0, requiredAnchorCount: 5 });
      assert.equal(JSON.stringify(error.details).includes('เขียน 2–4'), false);
      return true;
    },
  );
});

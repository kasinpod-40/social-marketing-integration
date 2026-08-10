import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_AUTOMATION_PROMPTS,
  LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
} from '../../packages/config/src/lark-native-ai-automation-prompt-contract.js';
import {
  LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_CONTRACT_VERSION,
} from '../../scripts/lib/lark-weekly-7d-executive-decision-preview.js';

test('keeps Prompt v3 field isolation while aligning Recommendations to the Decision Quality Gate', () => {
  assert.equal(LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION, 'lark_native_ai_automation_prompts_v3');
  const prompt = LARK_NATIVE_AI_AUTOMATION_PROMPTS.recommendations.text;

  assert.match(prompt, /หนึ่ง action ต่อหนึ่งบรรทัด/u);
  assert.match(prompt, /ห้ามรวมหลาย label ในบรรทัดเดียว/u);
  assert.match(prompt, /ห้ามตอบเพียง label \+ ชื่อ candidate/u);
  assert.match(prompt, /“ตรวจสอบ” อย่างเดียวไม่ถือเป็น action ที่เพียงพอ/u);
  assert.match(prompt, /ถ้า c=\[\] ห้ามใช้ \[CONTENT\]/u);
  assert.match(prompt, /ห้ามสร้าง Organic action จากชื่อช่องทาง/u);
  assert.match(prompt, /candidate ที่อยู่ใน a ห้ามใช้ \[CONTENT\]/u);
  assert.match(prompt, /\[TEST\]/u);
  assert.match(prompt, /\[SCALE\]/u);
  assert.match(prompt, /\[KEEP\]/u);
  assert.match(prompt, /\[REDUCE\]/u);
  assert.match(prompt, /\[STOP\]/u);
  assert.match(prompt, /\[NO-SCALE\]/u);
  assert.match(prompt, /scale=1/u);
  assert.match(prompt, /CTR, impressions, reach, clicks หรือ spend อย่างเดียวห้ามใช้เป็นเหตุผล Scale/u);
  assert.match(prompt, /funnelMetrics\.up และ funnelMetrics\.down/u);
  assert.match(prompt, /ไม่เพิ่มงบรวม เพราะ <metric up> เพิ่มขึ้นแต่ <metric down> ลดลง/u);
  assert.match(prompt, /มี a candidate และมี funnel divergence แต่ c=\[\]/u);
});

test('supersedes the generated quality-failed Fresh identity instead of resetting or retriggering it', () => {
  assert.equal(
    LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_CONTRACT_VERSION,
    'lark_weekly_7d_executive_decision_preview_v3',
  );
});

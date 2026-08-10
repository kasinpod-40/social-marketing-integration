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

  assert.match(prompt, /ทุกข้อ ต้องขึ้นต้นด้วย label เดียว/u);
  assert.match(prompt, /\[CONTENT\]/u);
  assert.match(prompt, /\[TEST\]/u);
  assert.match(prompt, /\[SCALE\]/u);
  assert.match(prompt, /\[KEEP\]/u);
  assert.match(prompt, /\[REDUCE\]/u);
  assert.match(prompt, /\[STOP\]/u);
  assert.match(prompt, /\[NO-SCALE\]/u);
  assert.match(prompt, /c=\[name,\.\.\.\]/u);
  assert.match(prompt, /a=\[name,\.\.\.\]/u);
  assert.match(prompt, /คำแนะนำ Organic แบบไม่ระบุชื่อ candidate ใช้ไม่ได้/u);
  assert.match(prompt, /คำแนะนำ Paid แบบระบุเพียงชื่อช่องทางใช้ไม่ได้/u);
  assert.match(prompt, /scale=1/u);
  assert.match(prompt, /CTR, impressions, reach, clicks หรือ spend อย่างเดียวห้ามใช้เป็นเหตุผล Scale/u);
  assert.match(prompt, /funnelMetrics\.up และ funnelMetrics\.down/u);
  assert.match(prompt, /ถ้ามี a candidate ต้องใช้ชื่อ candidate แทนคำแนะนำแบบ generic/u);
});

test('supersedes the generated quality-failed Fresh identity instead of resetting or retriggering it', () => {
  assert.equal(
    LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_CONTRACT_VERSION,
    'lark_weekly_7d_executive_decision_preview_v2',
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  assertLarkWeekly7dFullChannelAiGenerated,
} from '../../scripts/lib/lark-weekly-7d-full-channel-ai-synthesis.js';

const AI_RUN_KEY = `weekly-7d-full-channel-ai:${'a'.repeat(64)}`;

const outputs = Object.freeze({
  insight_summary: 'Meta Ads มีจำนวนการคลิก 4553 ครั้ง และควรติดตามผลในสัปดาห์ถัดไป',
  strengths: 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน',
  weaknesses: 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี',
  recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
});

test('quality failure preserves the exact generated outputs for poll-only diagnosis', () => {
  const fields = {
    ai_run_key: AI_RUN_KEY,
    generation_status: 'generated',
    failure_code: null,
    preview_mode: true,
    notification_eligible: false,
    sent_to_group: false,
    metric_summary_json: JSON.stringify({ promptShape: LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE }),
    ...outputs,
  };
  const expected = {
    aiRunKey: AI_RUN_KEY,
    evidence: {
      evidence: {
        businessEvidenceChannelCount: 1,
        comparisonEvidenceChannelCount: 0,
        businessEvidenceChannelNames: ['Meta Ads'],
        summaryRequiredFacts: [{ channel: 'Meta Ads', metric: 'clicks', value: 4553 }],
        derivedCtrFacts: [],
        recommendationMode: 'observed_only_business_followup',
      },
    },
  };

  assert.throws(
    () => assertLarkWeekly7dFullChannelAiGenerated(fields, expected),
    (error) => {
      assert.equal(error?.code, 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED');
      assert.ok(error?.details?.violations?.includes('insight_contains_action'));
      assert.deepEqual(error?.details?.outputs, outputs);
      return true;
    },
  );
});

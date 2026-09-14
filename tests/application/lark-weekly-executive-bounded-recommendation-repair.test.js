import assert from 'node:assert/strict';
import test from 'node:test';

import {
  repairLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';
import {
  acceptGeneratedWeeklyRecord,
} from '../../apps/sync-worker/src/lark-weekly-executive-auto.js';

function evidence() {
  return {
    businessEvidenceChannelCount: 1,
    comparisonEvidenceChannelCount: 1,
    recommendationMode: 'executive_decision_actions',
    businessEvidenceChannelNames: ['Meta Ads'],
    positiveComparisonChannelNames: ['Meta Ads'],
    negativeComparisonChannelNames: [],
    positiveComparisonMetricNames: ['การคลิก'],
    negativeComparisonMetricNames: [],
    positiveComparisonFacts: [{ channel: 'Meta Ads', metric: 'การคลิก', changePercent: 12 }],
    negativeComparisonFacts: [],
    neutralComparisonFacts: [],
    contentCandidateNames: [],
    adCandidateNames: ['Ad Alpha', 'Ad Beta'],
    scaleEvidenceAdNames: [],
    funnelDivergences: [],
    organicPaidMappingAvailable: false,
    summaryRequiredFacts: [{ channel: 'Meta Ads', metric: 'clicks', value: 120 }],
    derivedCtrFacts: [],
  };
}

function outputs() {
  return {
    insight_summary: 'Meta Ads มีการคลิก 120 ครั้งในรอบนี้',
    strengths: 'Meta Ads มีการคลิกเพิ่มขึ้น 12%',
    weaknesses: LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
    recommendations: [
      '[TEST] Ad Alpha ทดสอบต่อแบบจำกัดงบเพื่อวัดผลสัปดาห์ถัดไป',
      '[NO-SCALE] Meta Ads การคลิก 120 ครั้ง',
    ].join('\n'),
  };
}

test('removes unsupported NO-SCALE and adds one evidence-anchored bounded action', () => {
  const result = repairLarkWeeklyExecutiveFullChannelAiOutputs(outputs(), evidence());
  assert.equal(result.repaired, true);
  assert.equal(result.repairCode, 'bounded_recommendation_format_v1');
  assert.equal(result.qualityGate.passed, true);
  assert.doesNotMatch(result.outputs.recommendations, /\[NO-SCALE\]/u);
  assert.match(result.outputs.recommendations, /\[TEST\] Ad Beta/u);
});

test('does not repair unrelated quality failures or weaken the existing gate', () => {
  const invalid = {
    ...outputs(),
    insight_summary: 'Meta Ads มีการคลิก 120 ครั้งและควรเพิ่มงบ',
  };
  const result = repairLarkWeeklyExecutiveFullChannelAiOutputs(invalid, evidence());
  assert.equal(result.repaired, false);
  assert.ok(result.qualityGate.violations.includes('insight_contains_action'));
  assert.equal(result.outputs.insight_summary, invalid.insight_summary);
});

test('automatic Weekly uses only the repaired in-memory projection and preserves the retained row', () => {
  const retained = Object.freeze({ fields: Object.freeze(outputs()) });
  let calls = 0;
  const accepted = acceptGeneratedWeeklyRecord({
    record: retained,
    expected: { evidence: { evidence: evidence() } },
    assertGenerated(fields) {
      calls += 1;
      if (calls === 1) {
        const error = new Error('quality failed');
        error.code = 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED';
        error.details = { outputs: fields };
        throw error;
      }
      return { qualityGate: { passed: true, violations: [] } };
    },
  });
  assert.equal(calls, 2);
  assert.equal(accepted.repairCode, 'bounded_recommendation_format_v1');
  assert.equal(accepted.accepted.qualityGate.passed, true);
  assert.notEqual(accepted.record, retained);
  assert.equal(retained.fields.recommendations, outputs().recommendations);
  assert.doesNotMatch(accepted.record.fields.recommendations, /\[NO-SCALE\]/u);
});

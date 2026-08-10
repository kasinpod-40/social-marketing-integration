import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';

const EVIDENCE = Object.freeze({
  businessEvidenceChannelCount: 8,
  businessEvidenceChannelNames: Object.freeze([
    'TikTok Organic',
    'Facebook Organic',
    'Instagram Organic',
    'YouTube Organic',
    'Meta Ads',
    'Google Ads',
    'WooCommerce',
    'Chatwoot',
  ]),
  positiveComparisonChannelNames: Object.freeze(['Facebook Organic', 'Google Ads', 'WooCommerce']),
  negativeComparisonChannelNames: Object.freeze(['Meta Ads', 'Google Ads', 'Chatwoot']),
  positiveComparisonMetricNames: Object.freeze(['ผู้ติดตาม', 'การแสดงผล', 'ยอดขายสุทธิ']),
  negativeComparisonMetricNames: Object.freeze(['การแสดงผล', 'คอนเวอร์ชัน', 'New conversations']),
  neutralComparisonMetricNames: Object.freeze(['ค่าใช้จ่าย']),
  contentCandidateNames: Object.freeze([]),
  adCandidateNames: Object.freeze([
    'Sale M.5/1 02',
    'Sale TRI 01',
    '[7.2025] ขาย Combo สอวน 4990 1D',
  ]),
  scaleEvidenceAdNames: Object.freeze([]),
  funnelDivergences: Object.freeze([
    Object.freeze({
      type: 'awareness_up_outcome_down',
      positiveFacts: Object.freeze([
        Object.freeze({ channel: 'Google Ads', metric: 'การแสดงผล', signal: 'positive' }),
      ]),
      negativeFacts: Object.freeze([
        Object.freeze({ channel: 'Google Ads', metric: 'คอนเวอร์ชัน', signal: 'negative' }),
      ]),
      decisionRule: 'do_not_broadly_scale_until_lower_funnel_recovers',
    }),
  ]),
  organicPaidMappingAvailable: false,
});

test('rejects the latest live recommendation output instead of weakening the gate', () => {
  const checked = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'WooCommerce มียอดขายสุทธิ 209710 บาท Facebook Organic มีผู้ติดตาม 181448 คน และ Google Ads มีค่าใช้จ่าย 8446.395 บาท',
    strengths: 'Facebook Organic ผู้ติดตาม เพิ่มขึ้น Google Ads การแสดงผล เพิ่มขึ้น WooCommerce ยอดขายสุทธิ เพิ่มขึ้น',
    weaknesses: 'Meta Ads มีการแสดงผลลดลง Google Ads มีคอนเวอร์ชันลดลง Chatwoot มี New conversations ลดลง',
    recommendations: '[NO-SCALE] กำหนดงบประมาณกว้าง พร้อมอ้างอิง metric การแสดงผล และคอนเวอร์ชัน\n[TEST] ตรวจสอบ Paid candidate Sale M.5/1 02 จากข้อมูลที่มี\n[TEST] ตรวจสอบ Organic candidate TikTok Organic ที่ไม่มีหลักฐาน Paid รองรับ\n[CONTENT] ตรวจสอบ Content candidate Sale TRI 01 จากข้อมูลที่มี',
  }, EVIDENCE);

  assert.equal(checked.passed, false);
  assert.ok(checked.violations.includes('recommendations_missing_action_detail'));
  assert.ok(checked.violations.includes('recommendations_missing_evidence_anchor'));
});

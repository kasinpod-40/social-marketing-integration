import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK,
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  upgradeLarkNativeAiExecutiveWriterEvidence,
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';

function sourceEvidence() {
  const channels = [
    {
      channelKey: 'meta_ads',
      displayName: 'Meta Ads',
      businessEvidencePresent: true,
      comparisonEvidencePresent: false,
      topAds: [{
        rank: 1,
        ad_name: '(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา',
        clicks: 4553,
        impressions: 582054,
        spend_micros: 807690000000,
      }],
    },
    'tiktok_organic',
    'facebook_organic',
    'instagram_organic',
    'youtube_organic',
    'google_ads',
    'tiktok_ads',
    'woocommerce',
    'chatwoot',
  ].map((value) => typeof value === 'string'
    ? { channelKey: value, businessEvidencePresent: false, comparisonEvidencePresent: false }
    : value);
  return {
    metricSummaryJson: JSON.stringify({
      evidenceShape: 'executive_business_first_v2',
      promptShape: 'lark_ai_compact_quality_v4',
      qualityContext: {
        businessEvidenceChannelCount: 1,
        comparisonEvidenceChannelCount: 0,
        strengthsMode: 'fallback_no_comparison',
        recommendationMode: 'observed_only_business_followup',
      },
      writerContract: {
        role: 'weekly_executive_marketer',
        overview: 'existing compact writer rule',
      },
      channelBusinessEvidence: channels,
    }),
    channelStatusVectorJson: JSON.stringify(channels.map(({ channelKey }) => ({
      channelKey,
      readinessStatus: channelKey === 'meta_ads' ? 'report_partial' : 'source_unavailable',
    }))),
  };
}

const V7_OUTPUTS = Object.freeze({
  insight_summary: 'มีข้อมูลจากช่องทาง Meta Ads สำหรับสัปดาห์นี้ แคมเปญโฆษณา (01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา เป็นอันดับ 1 ในรายการที่มีข้อมูล ยังสรุปแนวโน้มไม่ได้ ช่องทางอื่นๆ หลายแห่งยังไม่มีข้อมูลที่ตรวจสอบแล้วสำหรับการรายงานระดับผู้บริหาร',
  strengths: LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK,
  weaknesses: LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
});

test('upgrades quality-v4 evidence with safe required Summary metric facts within the reviewed budget', () => {
  const upgraded = upgradeLarkNativeAiExecutiveWriterEvidence(sourceEvidence());
  assert.equal(upgraded.evidence.promptShape, 'lark_ai_compact_quality_v5');
  assert.equal(upgraded.evidence.businessEvidenceChannelCount, 1);
  assert.equal(upgraded.evidence.comparisonEvidenceChannelCount, 0);
  assert.deepEqual(upgraded.evidence.businessEvidenceChannelNames, ['Meta Ads']);
  assert.deepEqual(
    upgraded.evidence.summaryRequiredFacts.map(({ metric, value }) => [metric, value]),
    [['clicks', 4553], ['impressions', 582054]],
  );
  assert.ok(upgraded.metricSummaryChars <= 2800);
  assert.ok(upgraded.channelStatusVectorChars <= 700);
  const parsed = JSON.parse(upgraded.metricSummaryJson);
  assert.equal(parsed.promptShape, 'lark_ai_compact_quality_v5');
  assert.match(parsed.qualityContext.summaryFactRule, /rank_or_digits_in_names_do_not_count/);
});

test('reclassifies the exact V7 output to only missing a real business metric value', () => {
  const upgraded = upgradeLarkNativeAiExecutiveWriterEvidence(sourceEvidence());
  const gate = validateLarkNativeAiExecutiveWriterOutputs(V7_OUTPUTS, upgraded.evidence);
  assert.equal(gate.passed, false);
  assert.deepEqual(gate.violations, ['insight_missing_business_metric_value']);
});

test('does not treat verified-data prose or the exact weakness fallback as action language', () => {
  const upgraded = upgradeLarkNativeAiExecutiveWriterEvidence(sourceEvidence());
  const outputs = {
    ...V7_OUTPUTS,
    insight_summary: 'Meta Ads มีข้อมูลที่ตรวจสอบแล้ว โดยโฆษณาที่มีข้อมูลบันทึก 4,553 clicks และยังไม่มี comparison สำหรับสรุปแนวโน้ม',
  };
  const gate = validateLarkNativeAiExecutiveWriterOutputs(outputs, upgraded.evidence);
  assert.equal(gate.passed, true);
  assert.deepEqual(gate.violations, []);
});

test('campaign-name digits and rank do not satisfy the business metric requirement', () => {
  const upgraded = upgradeLarkNativeAiExecutiveWriterEvidence(sourceEvidence());
  const gate = validateLarkNativeAiExecutiveWriterOutputs(V7_OUTPUTS, upgraded.evidence);
  assert.ok(gate.violations.includes('insight_missing_business_metric_value'));
});

test('still rejects genuine action leakage outside Recommendations', () => {
  const upgraded = upgradeLarkNativeAiExecutiveWriterEvidence(sourceEvidence());
  const insightAction = validateLarkNativeAiExecutiveWriterOutputs({
    ...V7_OUTPUTS,
    insight_summary: 'Meta Ads บันทึก 4,553 clicks และควรตรวจสอบ Creative ต่อในสัปดาห์หน้า',
  }, upgraded.evidence);
  assert.ok(insightAction.violations.includes('insight_contains_action'));

  const weaknessAction = validateLarkNativeAiExecutiveWriterOutputs({
    ...V7_OUTPUTS,
    insight_summary: 'Meta Ads บันทึก 4,553 clicks และยังไม่มี comparison สำหรับสรุปแนวโน้ม',
    weaknesses: 'ควรติดตามผลของโฆษณานี้ต่อ',
  }, upgraded.evidence);
  assert.ok(weaknessAction.violations.includes('weaknesses_contains_action'));
});

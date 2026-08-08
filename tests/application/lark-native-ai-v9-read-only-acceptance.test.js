import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK,
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  readLarkNativeAiExecutiveBusinessMetricEvidence,
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';

function retainedV9Evidence() {
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
        derived_ctr_percent: 0.78223,
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
      promptShape: 'lark_ai_compact_quality_v6',
      qualityContext: {
        businessEvidenceChannelCount: 1,
        comparisonEvidenceChannelCount: 0,
        strengthsMode: 'fallback_no_comparison',
        recommendationMode: 'observed_only_business_followup',
        summaryRequiredFacts: [
          { channel: 'Meta Ads', metric: 'clicks', value: 4553 },
          { channel: 'Meta Ads', metric: 'impressions', value: 582054 },
          { channel: 'Meta Ads', metric: 'derived_ctr_percent', value: 0.78223 },
        ],
      },
      channelBusinessEvidence: channels,
    }),
    channelStatusVectorJson: JSON.stringify(channels.map(({ channelKey }) => ({
      channelKey,
      readinessStatus: channelKey === 'meta_ads' ? 'report_partial' : 'source_unavailable',
    }))),
  };
}

const V9_OUTPUTS = Object.freeze({
  insight_summary: 'Meta Ads มีจำนวนการคลิก 4553 ครั้ง และการแสดงผล 582054 ครั้ง ค่าดัชนีการคลิกที่คำนวณได้เป็น 0.78223 เปอร์เซ็นต์ แคมเปญโฆษณา (01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา เป็นอันดับ 1 ในรายการที่มีข้อมูล ยังสรุปแนวโน้มผลงานไม่ได้เนื่องจากขาดข้อมูลเปรียบเทียบ',
  strengths: LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK,
  weaknesses: LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
});

test('reads retained quality-v6 evidence and reconstructs deterministic CTR facts', () => {
  const evidence = readLarkNativeAiExecutiveBusinessMetricEvidence(retainedV9Evidence());
  assert.equal(evidence.promptShape, 'lark_ai_compact_quality_v6');
  assert.equal(evidence.businessEvidenceChannelCount, 1);
  assert.deepEqual(evidence.businessEvidenceChannelNames, ['Meta Ads']);
  assert.deepEqual(evidence.summaryRequiredFacts.map(({ metric, value }) => [metric, value]), [
    ['clicks', 4553],
    ['impressions', 582054],
    ['derived_ctr_percent', 0.78223],
  ]);
  assert.equal(evidence.derivedCtrFacts.length, 1);
  assert.equal(evidence.derivedCtrFacts[0].derivedCtrPercent, 0.78223);
});

test('accepts descriptive Thai calculated-metric prose from the retained V9 output', () => {
  const evidence = readLarkNativeAiExecutiveBusinessMetricEvidence(retainedV9Evidence());
  const gate = validateLarkNativeAiExecutiveWriterOutputs(V9_OUTPUTS, evidence);
  assert.equal(gate.passed, true);
  assert.deepEqual(gate.violations, []);
});

test('still rejects an imperative calculate action in insight', () => {
  const evidence = readLarkNativeAiExecutiveBusinessMetricEvidence(retainedV9Evidence());
  const gate = validateLarkNativeAiExecutiveWriterOutputs({
    ...V9_OUTPUTS,
    insight_summary: 'Meta Ads มี 4553 clicks และ 582054 impressions คำนวณ CTR เพิ่มเพื่อใช้ตัดสินใจสัปดาห์หน้า',
  }, evidence);
  assert.ok(gate.violations.includes('insight_contains_action'));
});

test('validates Thai CTR wording and rejects a contradictory percent', () => {
  const evidence = readLarkNativeAiExecutiveBusinessMetricEvidence(retainedV9Evidence());
  const gate = validateLarkNativeAiExecutiveWriterOutputs({
    ...V9_OUTPUTS,
    insight_summary: 'Meta Ads มีจำนวนการคลิก 4553 ครั้ง และการแสดงผล 582054 ครั้ง ค่าดัชนีการคลิกที่คำนวณได้เป็น 0 เปอร์เซ็นต์',
  }, evidence);
  assert.ok(gate.violations.includes('insight_ctr_inconsistent_with_components'));
});

test('rejects retained quality-v6 evidence whose derived CTR disagrees with components', () => {
  const source = retainedV9Evidence();
  const parsed = JSON.parse(source.metricSummaryJson);
  parsed.channelBusinessEvidence[0].topAds[0].derived_ctr_percent = 0;
  assert.throws(
    () => readLarkNativeAiExecutiveBusinessMetricEvidence({
      ...source,
      metricSummaryJson: JSON.stringify(parsed),
    }),
    (error) => error?.code === 'LARK_AI_EXECUTIVE_WRITER_V9_ACCEPTANCE_DERIVED_CTR_INVALID',
  );
});

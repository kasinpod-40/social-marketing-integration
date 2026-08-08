import assert from 'node:assert/strict';
import test from 'node:test';
import { hardenLarkNativeAiWeeklyEvidence } from '../../packages/application/src/reports/harden-lark-native-ai-weekly-evidence.js';

function statusVector() {
  return Array.from({ length: 9 }, (_, index) => ({
    channelKey: `channel_${index}`,
    readinessStatus: index < 4 ? 'report_partial' : 'report_missing',
  }));
}

function compactSummary(promptShape = 'lark_ai_compact_v1') {
  return {
    evidenceShape: 'executive_business_first_v2',
    promptShape,
    overallCoverageState: 'partial_coverage',
    channelBusinessEvidence: [
      {
        channelKey: 'facebook_organic',
        displayName: 'Facebook Organic',
        readinessStatus: 'report_available',
        topContent: [{
          caption: 'ไม่มีข้อมูล',
          content_url: 'https://invalid.example/',
          data_status: 'complete',
          external_content_id: 'no_data_1',
          latest_total_views: null,
          performance_status: 'no_data',
          rank: 1,
        }],
      },
      {
        channelKey: 'instagram_organic',
        displayName: 'Instagram Organic',
        readinessStatus: 'report_partial',
        topContent: [{ rank: 1, title: 'โพสต์ A', views: 120 }],
      },
      {
        channelKey: 'meta_ads',
        displayName: 'Meta Ads',
        readinessStatus: 'report_partial',
        topAds: [{ rank: 1, ad_name: 'Ad A', clicks: 40, spend_micros: 2500000 }],
      },
      {
        channelKey: 'woocommerce',
        displayName: 'WooCommerce',
        readinessStatus: 'report_partial',
        collections: { product: [{ name: 'Product A', value: 3 }] },
      },
      ...Array.from({ length: 5 }, (_, index) => ({
        channelKey: `missing_${index}`,
        displayName: `Missing ${index}`,
        readinessStatus: 'report_missing',
      })),
    ],
  };
}

test('removes no-data placeholders and adds deterministic quality-v3 interpretation context', () => {
  const hardened = hardenLarkNativeAiWeeklyEvidence({
    metricSummaryJson: JSON.stringify(compactSummary()),
    channelStatusVectorJson: JSON.stringify(statusVector()),
  });
  const parsed = JSON.parse(hardened.metricSummaryJson);

  assert.equal(parsed.promptShape, 'lark_ai_compact_quality_v3');
  assert.equal(parsed.channelBusinessEvidence.length, 9);
  assert.equal(parsed.channelBusinessEvidence[0].businessEvidencePresent, false);
  assert.equal(parsed.channelBusinessEvidence[0].observationMode, 'no_business_evidence');
  assert.equal(Object.hasOwn(parsed.channelBusinessEvidence[0], 'topContent'), false);
  assert.equal(parsed.channelBusinessEvidence[1].topContent[0].views, 120);
  assert.equal(parsed.channelBusinessEvidence[1].observationMode, 'observed_only');
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].clicks, 40);
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].spend_micros, 2500000);
  assert.equal(parsed.channelBusinessEvidence[2].comparisonEvidencePresent, false);
  assert.equal(parsed.qualityContext.businessEvidenceChannelCount, 3);
  assert.equal(parsed.qualityContext.comparisonEvidenceChannelCount, 0);
  assert.equal(parsed.qualityContext.strengthsFallbackRequired, true);
  assert.equal(parsed.qualityContext.recommendationMode, 'observed_only_followup');
  assert.match(parsed.interpretationPolicy.absoluteMagnitude, /ห้ามใช้คำว่า มาก น้อย สูง ต่ำ เด่น ดี แย่/u);
  assert.match(parsed.interpretationPolicy.strengths, /ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน/u);
  assert.match(parsed.interpretationPolicy.recommendations, /ห้ามแนะนำเติมข้อมูลหรือแก้ระบบ/u);
  assert.match(parsed.interpretationPolicy.wording, /ความรู้สึกเบื้องหลังผลลัพธ์/u);
  assert.ok(hardened.metricSummaryChars <= 2800);
  assert.ok(hardened.channelStatusVectorChars <= 700);
});

test('accepts the retained quality-v2 evidence shape and upgrades it to quality v3', () => {
  const summary = compactSummary('lark_ai_compact_quality_v2');
  summary.interpretationPolicy = { absoluteMagnitude: 'require_comparison_or_benchmark' };
  summary.channelBusinessEvidence[2].businessEvidencePresent = true;
  summary.channelBusinessEvidence[2].comparisonEvidencePresent = false;

  const hardened = hardenLarkNativeAiWeeklyEvidence({
    metricSummaryJson: JSON.stringify(summary),
    channelStatusVectorJson: JSON.stringify(statusVector()),
  });
  const parsed = JSON.parse(hardened.metricSummaryJson);

  assert.equal(hardened.promptShape, 'lark_ai_compact_quality_v3');
  assert.equal(parsed.promptShape, 'lark_ai_compact_quality_v3');
  assert.equal(parsed.channelBusinessEvidence[2].observationMode, 'observed_only');
  assert.equal(parsed.qualityContext.strengthsFallbackRequired, true);
});

test('preserves comparison evidence and enables comparison-supported actions', () => {
  const summary = compactSummary('lark_ai_compact_quality_v2');
  summary.channelBusinessEvidence[1].availableMetrics = [{
    metric_key: 'reach',
    current_value: 120,
    previous_value: 100,
    change_percent: 20,
  }];
  const hardened = hardenLarkNativeAiWeeklyEvidence({
    metricSummaryJson: JSON.stringify(summary),
    channelStatusVectorJson: JSON.stringify(statusVector()),
  });
  const parsed = JSON.parse(hardened.metricSummaryJson);
  const instagram = parsed.channelBusinessEvidence[1];

  assert.equal(instagram.comparisonEvidencePresent, true);
  assert.equal(instagram.observationMode, 'comparison_supported');
  assert.equal(instagram.availableMetrics[0].current_value, 120);
  assert.equal(instagram.availableMetrics[0].previous_value, 100);
  assert.equal(instagram.availableMetrics[0].change_percent, 20);
  assert.equal(parsed.qualityContext.comparisonEvidenceChannelCount, 1);
  assert.equal(parsed.qualityContext.strengthsFallbackRequired, false);
  assert.equal(parsed.qualityContext.recommendationMode, 'comparison_supported_action');
});

test('rejects an unsupported or already-consumed source shape', () => {
  for (const promptShape of ['legacy', 'lark_ai_compact_quality_v3']) {
    assert.throws(
      () => hardenLarkNativeAiWeeklyEvidence({
        metricSummaryJson: JSON.stringify({
          evidenceShape: 'executive_business_first_v2',
          promptShape,
          channelBusinessEvidence: Array.from({ length: 9 }, () => ({})),
        }),
        channelStatusVectorJson: JSON.stringify(statusVector()),
      }),
      (error) => error?.code === 'LARK_AI_QUALITY_EVIDENCE_SHAPE_INVALID',
    );
  }
});

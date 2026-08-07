import assert from 'node:assert/strict';
import test from 'node:test';
import { hardenLarkNativeAiWeeklyEvidence } from '../../packages/application/src/reports/harden-lark-native-ai-weekly-evidence.js';

function statusVector() {
  return Array.from({ length: 9 }, (_, index) => ({
    channelKey: `channel_${index}`,
    readinessStatus: index < 4 ? 'report_partial' : 'report_missing',
  }));
}

function compactSummary() {
  return {
    evidenceShape: 'executive_business_first_v2',
    promptShape: 'lark_ai_compact_v1',
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

test('removes no-data placeholders and adds conservative interpretation policy', () => {
  const hardened = hardenLarkNativeAiWeeklyEvidence({
    metricSummaryJson: JSON.stringify(compactSummary()),
    channelStatusVectorJson: JSON.stringify(statusVector()),
  });
  const parsed = JSON.parse(hardened.metricSummaryJson);

  assert.equal(parsed.promptShape, 'lark_ai_compact_quality_v2');
  assert.equal(parsed.channelBusinessEvidence.length, 9);
  assert.equal(parsed.channelBusinessEvidence[0].businessEvidencePresent, false);
  assert.equal(Object.hasOwn(parsed.channelBusinessEvidence[0], 'topContent'), false);
  assert.equal(parsed.channelBusinessEvidence[1].topContent[0].views, 120);
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].clicks, 40);
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].spend_micros, 2500000);
  assert.equal(parsed.channelBusinessEvidence[2].comparisonEvidencePresent, false);
  assert.equal(parsed.interpretationPolicy.absoluteMagnitude, 'require_comparison_or_benchmark');
  assert.equal(parsed.interpretationPolicy.spend, 'observed_value_never_implies_planning_intent');
  assert.equal(parsed.interpretationPolicy.consistency, 'same_fact_interpretation_across_all_four_outputs');
  assert.ok(hardened.metricSummaryChars <= 2800);
  assert.ok(hardened.channelStatusVectorChars <= 700);
});

test('preserves comparison evidence without inventing a baseline', () => {
  const summary = compactSummary();
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
  assert.equal(instagram.availableMetrics[0].current_value, 120);
  assert.equal(instagram.availableMetrics[0].previous_value, 100);
  assert.equal(instagram.availableMetrics[0].change_percent, 20);
});

test('rejects a non-compact source shape', () => {
  assert.throws(
    () => hardenLarkNativeAiWeeklyEvidence({
      metricSummaryJson: JSON.stringify({
        evidenceShape: 'executive_business_first_v2',
        promptShape: 'legacy',
        channelBusinessEvidence: Array.from({ length: 9 }, () => ({})),
      }),
      channelStatusVectorJson: JSON.stringify(statusVector()),
    }),
    (error) => error?.code === 'LARK_AI_QUALITY_EVIDENCE_SHAPE_INVALID',
  );
});

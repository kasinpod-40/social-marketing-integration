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
    qualityContext: {
      businessEvidenceChannelCount: 3,
      comparisonEvidenceChannelCount: 0,
    },
    interpretationPolicy: { legacy: 'ignored during quality-v4 projection' },
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
        topAds: [{ rank: 1, ad_name: 'Ad A', clicks: 40, impressions: 1000, spend_micros: 2500000 }],
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

test('projects reviewed evidence into compact executive-writer quality v4', () => {
  const hardened = hardenLarkNativeAiWeeklyEvidence({
    metricSummaryJson: JSON.stringify(compactSummary('lark_ai_compact_quality_v3')),
    channelStatusVectorJson: JSON.stringify(statusVector()),
  });
  const parsed = JSON.parse(hardened.metricSummaryJson);

  assert.equal(parsed.promptShape, 'lark_ai_compact_quality_v4');
  assert.equal(parsed.channelBusinessEvidence.length, 9);
  assert.equal(parsed.channelBusinessEvidence[0].businessEvidencePresent, false);
  assert.equal(Object.hasOwn(parsed.channelBusinessEvidence[0], 'topContent'), false);
  assert.equal(Object.hasOwn(parsed.channelBusinessEvidence[0], 'readinessStatus'), false);
  assert.equal(Object.hasOwn(parsed.channelBusinessEvidence[0], 'displayName'), false);
  assert.equal(parsed.channelBusinessEvidence[1].displayName, 'Instagram Organic');
  assert.equal(parsed.channelBusinessEvidence[1].topContent[0].views, 120);
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].clicks, 40);
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].impressions, 1000);
  assert.equal(parsed.channelBusinessEvidence[2].topAds[0].spend_micros, 2500000);
  assert.equal(parsed.qualityContext.businessEvidenceChannelCount, 3);
  assert.equal(parsed.qualityContext.comparisonEvidenceChannelCount, 0);
  assert.equal(parsed.qualityContext.strengthsMode, 'fallback_no_comparison');
  assert.equal(parsed.qualityContext.recommendationMode, 'observed_only_business_followup');
  assert.equal(parsed.writerContract.role, 'weekly_executive_marketer');
  assert.match(parsed.writerContract.overview, /business facts 2-4 ประโยค/u);
  assert.match(parsed.writerContract.strengths, /exactly/u);
  assert.match(parsed.writerContract.weaknesses, /performance-only/u);
  assert.match(parsed.writerContract.weaknesses, /ห้าม recommendation/u);
  assert.match(parsed.writerContract.recommendations, /business-action-only/u);
  assert.match(parsed.writerContract.recommendations, /CTR\/CPC/u);
  assert.match(parsed.writerContract.output, /ไม่ใส่ Markdown heading/u);
  assert.equal(Object.hasOwn(parsed, 'interpretationPolicy'), false);
  assert.equal(Object.hasOwn(parsed, 'overallCoverageState'), false);
  assert.ok(hardened.metricSummaryChars <= 2800);
  assert.ok(hardened.channelStatusVectorChars <= 700);
});

test('accepts compact v1, quality v2 and retained quality v3 as reviewed sources', () => {
  for (const promptShape of [
    'lark_ai_compact_v1',
    'lark_ai_compact_quality_v2',
    'lark_ai_compact_quality_v3',
  ]) {
    const hardened = hardenLarkNativeAiWeeklyEvidence({
      metricSummaryJson: JSON.stringify(compactSummary(promptShape)),
      channelStatusVectorJson: JSON.stringify(statusVector()),
    });
    assert.equal(hardened.promptShape, 'lark_ai_compact_quality_v4');
    assert.equal(hardened.strengthsMode, 'fallback_no_comparison');
    assert.equal(hardened.recommendationMode, 'observed_only_business_followup');
  }
});

test('preserves real comparison evidence and enables comparison-supported writing', () => {
  const summary = compactSummary('lark_ai_compact_quality_v3');
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
  assert.equal(parsed.qualityContext.comparisonEvidenceChannelCount, 1);
  assert.equal(parsed.qualityContext.strengthsMode, 'comparison_supported');
  assert.equal(parsed.qualityContext.recommendationMode, 'comparison_supported_action');
});

test('rejects unsupported or already-consumed quality-v4 evidence', () => {
  for (const promptShape of ['legacy', 'lark_ai_compact_quality_v4']) {
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

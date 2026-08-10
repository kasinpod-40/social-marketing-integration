import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';

const STATUS_CHANNELS = [
  'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
  'meta_ads', 'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot',
];

function metric(metricKey, displayName, currentValue, compareValue, rank = 1) {
  return {
    metric_key: metricKey,
    display_name: displayName,
    current_value: currentValue,
    compare_value: compareValue,
    unit: 'count',
    availability_status: 'available',
    metric_scope: 'period_delta',
    dimension_type: 'summary',
    rank,
  };
}

test('AI metric summary keeps ranked candidates once without legacy duplicate aliases', () => {
  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: {
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
      compareStart: '2026-07-27',
      compareEnd: '2026-08-02',
      comparisonMode: 'previous_period',
    },
    reportBundles: [{
      channelKey: 'facebook_organic',
      reportId: 'facebook-fresh-7d',
      payload: { dataStatus: 'complete' },
      metricValues: [metric('facebook:account_views', 'Views', 150000, 120000)],
      topContent: [1, 2, 3].map((rank) => ({
        rank,
        external_content_id: `fb-content-${rank}`,
        caption: `Fresh Facebook Content ${rank}`,
        period_views: 150000 - (rank * 10000),
        period_likes: 8000 - (rank * 500),
        period_comments: 300 - (rank * 20),
        period_shares: 1200 - (rank * 100),
        period_engagement: 9500 - (rank * 500),
        period_engagement_rate: 6.3 - (rank * 0.2),
        data_status: 'complete',
      })),
      topAds: [],
    }, {
      channelKey: 'meta_ads',
      reportId: 'meta-fresh-7d',
      payload: { dataStatus: 'complete' },
      metricValues: [
        metric('meta_ads:impressions', 'Impressions', 120000, 100000, 1),
        metric('meta_ads:clicks', 'Clicks', 3200, 4000, 2),
      ],
      topContent: [],
      topAds: [1, 2, 3].map((rank) => ({
        rank,
        external_ad_id: `ad-${rank}`,
        ad_name: `Fresh Paid Candidate ${rank}`,
        spend_micros: 1_500_000_000 - (rank * 100_000_000),
        impressions: 120000 - (rank * 10000),
        reach: 100000 - (rank * 8000),
        clicks: 3200 - (rank * 200),
        conversions: 42 - rank,
        conversion_value_micros: 4_800_000_000 - (rank * 200_000_000),
        cpc_micros: 450000 + (rank * 10000),
        cpa_micros: 35_000_000 + (rank * 1_000_000),
        roas: 4 - (rank * 0.2),
        data_status: 'complete',
      })),
    }],
  });

  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport,
    channelStatusVectorJson: JSON.stringify(STATUS_CHANNELS.map((channelKey) => ({ channelKey }))),
  });
  const summary = JSON.parse(built.metricSummaryJson);
  const facebook = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'facebook_organic');
  const meta = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'meta_ads');

  assert.equal(facebook.contentCandidates.length, 3);
  assert.equal(meta.adCandidates.length, 3);
  assert.equal(Object.hasOwn(facebook, 'topContent'), false);
  assert.equal(Object.hasOwn(meta, 'topAds'), false);
  assert.equal(Object.hasOwn(summary.decisionEvidence, 'contentCandidates'), false);
  assert.equal(Object.hasOwn(summary.decisionEvidence, 'adCandidates'), false);
  assert.equal(summary.decisionEvidence.scaleEvidenceAdNames.length, 3);
  assert.equal(summary.decisionEvidence.funnelDivergences.length, 1);
  assert.equal(built.evidence.contentCandidateNames.length, 3);
  assert.equal(built.evidence.adCandidateNames.length, 3);
  assert.equal(built.evidence.scaleEvidenceAdNames.length, 3);
  assert.equal(built.evidence.funnelDivergences.length, 1);
  assert.ok(built.metricSummaryChars <= 8000);
});

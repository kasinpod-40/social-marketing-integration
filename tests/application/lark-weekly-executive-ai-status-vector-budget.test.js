import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';

const CHANNELS = [
  ['tiktok_organic', 'TikTok Organic', 'report_available'],
  ['facebook_organic', 'Facebook Organic', 'report_available'],
  ['instagram_organic', 'Instagram Organic', 'report_available'],
  ['youtube_organic', 'YouTube Organic', 'report_partial'],
  ['meta_ads', 'Meta Ads', 'report_available'],
  ['google_ads', 'Google Ads', 'no_data_confirmed'],
  ['tiktok_ads', 'TikTok Ads', 'configuration_missing'],
  ['woocommerce', 'WooCommerce', 'report_available'],
  ['chatwoot', 'Chatwoot', 'report_partial'],
];

function factualReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: {
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
      compareStart: '2026-07-27',
      compareEnd: '2026-08-02',
      comparisonMode: 'previous_period',
    },
    reportBundles: [],
  });
}

function verboseStatusVector() {
  return CHANNELS.map(([channelKey, displayName, readinessStatus], index) => ({
    channelKey,
    displayName,
    readinessStatus,
    readinessMessage: `Internal readiness explanation for ${displayName} that is not business evidence`,
    severity: readinessStatus === 'configuration_missing' ? 'warning' : 'info',
    sourceReportChecksum: String(index + 1).repeat(64).slice(0, 64),
    availableMetricCount: index + 1,
  }));
}

test('AI evidence compacts verbose Executive status rows to channel identity plus readiness only', () => {
  const source = verboseStatusVector();
  assert.ok(JSON.stringify(source).length > 700);

  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: factualReport(),
    channelStatusVectorJson: JSON.stringify(source),
  });
  const compact = JSON.parse(built.channelStatusVectorJson);

  assert.equal(compact.length, 9);
  assert.ok(built.channelStatusVectorChars <= 700);
  assert.deepEqual(
    compact.map(({ channelKey, readinessStatus }) => [channelKey, readinessStatus]),
    CHANNELS.map(([channelKey, , readinessStatus]) => [channelKey, readinessStatus]),
  );
  for (const row of compact) {
    assert.deepEqual(Object.keys(row).sort(), ['channelKey', 'readinessStatus']);
    assert.equal(Object.hasOwn(row, 'readinessMessage'), false);
    assert.equal(Object.hasOwn(row, 'sourceReportChecksum'), false);
    assert.equal(Object.hasOwn(row, 'availableMetricCount'), false);
  }
});

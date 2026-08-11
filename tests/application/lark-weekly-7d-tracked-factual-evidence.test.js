import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildLarkExecutiveNotificationMessage,
} from '../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  readLarkWeeklyExecutiveCompactAiEvidence,
} from '../../packages/application/src/reports/read-lark-weekly-executive-compact-ai-evidence.js';
import {
  LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256,
  LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER,
  renderAcceptedWeekly7dChannelSections,
} from '../../scripts/lib/lark-weekly-7d-accepted-factual-render.js';

const PERIOD = Object.freeze({
  periodStart: '2026-08-03',
  periodEnd: '2026-08-09',
  compareStart: '2026-07-27',
  compareEnd: '2026-08-02',
  comparisonMode: 'previous_period',
});

function metric(metricKey, displayName, currentValue, compareValue, unit = 'count', rank = 1) {
  return {
    metric_key: metricKey,
    display_name: displayName,
    current_value: currentValue,
    compare_value: compareValue,
    change_percent: null,
    unit,
    availability_status: 'available',
    metric_scope: 'period_delta',
    dimension_type: 'summary',
    rank,
  };
}
function bundle(channelKey, metricValues, extra = {}) {
  return {
    channelKey,
    reportId: `report-${channelKey}`,
    payload: { dataStatus: 'complete' },
    metricValues,
    topContent: [],
    topAds: [],
    ...extra,
  };
}
function compactRoundTripReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [
      bundle('facebook_organic', [
        metric('facebook:account_followers', 'Followers', 181448, 181086),
      ]),
      bundle('meta_ads', [
        metric('meta_ads:spend_micros', 'Spend', 2857350000, 12877200000, 'currency', 1),
        metric('meta_ads:impressions', 'Impressions', 406054, 2308260, 'count', 2),
        metric('meta_ads:clicks', 'Clicks', 5387, 29072, 'count', 3),
      ], {
        topAds: [{
          rank: 1,
          external_ad_id: 'meta-ad-1',
          ad_name: 'Sale M.5/1 02',
          spend_micros: 122500000,
          clicks: 57,
          impressions: 4352,
          conversions: 0,
          conversion_value_micros: 0,
          cpc_micros: 2149123,
          cpa_micros: null,
          roas: null,
          data_status: 'complete',
        }],
      }),
      bundle('google_ads', [
        metric('google_ads:spend_micros', 'Spend', 8446400000, 7771000000, 'currency', 1),
        metric('google_ads:impressions', 'Impressions', 274173, 211391, 'count', 2),
        metric('google_ads:conversions', 'Conversions', 0, 5, 'count', 3),
      ]),
    ],
  });
}
function statusVector(report) {
  return JSON.stringify(report.channels.map(({ channelKey }) => ({
    channelKey,
    readinessStatus: 'report_ready',
  })));
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

test('tracked factual channel rendering is byte-identical to the previously reviewed a732 factual body', () => {
  const sections = renderAcceptedWeekly7dChannelSections();
  assert.equal(Buffer.byteLength(sections, 'utf8'), 2117);
  assert.equal(sha256(sections), LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256);
  assert.equal(LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER.channelSections.length, 9);
  assert.equal(
    LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER.factualReportSha256,
    'a732d4c4790ef99261e23e6a129a38822e9268a1f478387dfc2e82126b8a6fea',
  );

  const oldOutputs = Object.freeze({
    insight_summary: 'WooCommerce มียอดขายสุทธิ 209,710 บาท ยอดขายรวม 210,810 บาท และรายได้ที่รับรู้ 209,710 บาท Facebook Organic มีผู้ติดตาม 181,448 คน YouTube Organic มี Total views 34,508,913 ครั้ง ค่าทั้งหมดเหล่านี้มีข้อมูลเพียงปัจจุบันจึงยังสรุปแนวโน้มไม่ได้ ส่วนอื่นๆ มีข้อมูลบางส่วนเท่านั้น',
    strengths: '- Facebook Organic มีผู้ติดตามเพิ่มขึ้น\n- WooCommerce มียอดขายสุทธิ เพิ่มขึ้น ยอดขายรวมเพิ่มขึ้น รายได้ที่รับรู้เพิ่มขึ้น\n- Meta Ads มีแคมเปญอันดับ 1 ในรายการที่มีข้อมูล',
    weaknesses: '- Meta Ads มีการแสดงผล และการเข้าถึง ลดลง\n- Google Ads มีการคอนเวอร์ชัน ลดลง\n- Chatwoot มีการสนทนาที่แก้ไขแล้ว และการสนทนาใหม่ ลดลง',
    recommendations: '[TEST] Sale M.5/1 02\n[NO-SCALE] broad budget\n[TEST] TikTok Organic\n[TEST] Instagram Organic',
  });
  const message = buildLarkExecutiveNotificationMessage({
    aiRun: {
      aiRunKey: 'proof-old-reviewed-message',
      reportId: 'proof-old-reviewed-message',
      templateVersion: 'executive_weekly_7d_notification_v1',
      scopeType: 'executive',
      generationStatus: 'generated',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: 'a'.repeat(64),
      windowDays: 7,
      readinessStatus: 'report_partial',
      severity: 'info',
      insightSummary: `${oldOutputs.insight_summary}\n\n${sections}`,
      strengths: oldOutputs.strengths,
      weaknesses: oldOutputs.weaknesses,
      recommendations: oldOutputs.recommendations,
    },
    snapshot: {
      reportId: 'proof-old-reviewed-message',
      reportSettingKey: 'proof-setting',
      customerProfile: 'integration_workspace',
      periodStart: '2026-08-03',
      periodEnd: '2026-08-09',
    },
    settings: {
      enabled: true,
      aiEnabled: true,
      notificationEnabled: true,
      groupId: 'proof-group',
      destinationKeyHash: 'b'.repeat(64),
    },
  });
  assert.equal(Buffer.byteLength(message.text, 'utf8'), 3895);
  assert.equal(
    sha256(message.text),
    '8022c046031c8b6e0118dd586b4c08f3cba539a393a8033ebf2567dffcf1ac17',
  );
});

test('compact evidence reader reconstructs the Quality-Gate decision facts emitted by the shared producer', () => {
  const report = compactRoundTripReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const read = readLarkWeeklyExecutiveCompactAiEvidence({
    metricSummaryJson: built.metricSummaryJson,
    channelStatusVectorJson: built.channelStatusVectorJson,
  });
  const summary = JSON.parse(built.metricSummaryJson);

  assert.equal(read.promptShape, built.evidence.promptShape);
  assert.equal(read.businessEvidenceChannelCount, built.evidence.businessEvidenceChannelCount);
  assert.equal(read.comparisonEvidenceChannelCount, built.evidence.comparisonEvidenceChannelCount);
  assert.deepEqual(read.businessEvidenceChannelNames, built.evidence.businessEvidenceChannelNames);
  assert.deepEqual(read.positiveComparisonChannelNames, built.evidence.positiveComparisonChannelNames);
  assert.deepEqual(read.negativeComparisonChannelNames, built.evidence.negativeComparisonChannelNames);
  assert.deepEqual(read.positiveComparisonMetricNames, built.evidence.positiveComparisonMetricNames);
  assert.deepEqual(read.negativeComparisonMetricNames, built.evidence.negativeComparisonMetricNames);
  assert.deepEqual(read.neutralComparisonMetricNames, built.evidence.neutralComparisonMetricNames);
  assert.deepEqual(read.contentCandidateNames, built.evidence.contentCandidateNames);
  assert.deepEqual(read.adCandidateNames, built.evidence.adCandidateNames);
  assert.deepEqual(read.scaleEvidenceAdNames, built.evidence.scaleEvidenceAdNames);
  assert.deepEqual(
    read.funnelDivergences.map(({ positiveFacts, negativeFacts }) => ({
      up: [...new Set(positiveFacts.map(({ metric }) => metric))],
      down: [...new Set(negativeFacts.map(({ metric }) => metric))],
    })),
    [{ up: summary.funnelMetrics.up, down: summary.funnelMetrics.down }],
  );
  assert.deepEqual(read.recommendationBlueprints, summary.rb);
  assert.equal(read.organicPaidMappingAvailable, false);
  assert.equal(read.statusVector.length, 9);
});

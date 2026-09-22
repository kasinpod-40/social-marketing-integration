import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import { LARK_NATIVE_AI_CHANNELS } from '../packages/config/src/lark-native-ai-all-channel-contract.js';
import {
  buildLarkWeekly7dDisplaySections,
  buildLarkWeekly7dFactualOverview,
} from '../scripts/lib/lark-weekly-7d-full-channel-notification.js';

function emptyChannel(channel) {
  return {
    channelKey: channel.channelKey,
    displayName: channel.displayName,
    platform: channel.platform,
    capability: channel.capability,
    sourceReportId: null,
    dataStatus: null,
    metrics: [],
    contentCandidates: [],
    adCandidates: [],
    topContent: null,
    topAd: null,
    hasBusinessFacts: false,
  };
}

function metric({ metricKey, displayName, currentValue, compareValue, rank = 1 }) {
  return {
    metricKey,
    displayName,
    currentValue,
    displayValue: currentValue,
    compareValue,
    changeValue: null,
    changePercent: null,
    unit: 'count',
    rank,
  };
}

function content(rank, caption, periodViews) {
  return {
    rank,
    externalContentId: `content-${rank}`,
    caption,
    contentUrl: null,
    publishedAt: null,
    periodViews,
    periodLikes: null,
    periodComments: null,
    periodShares: null,
    periodEngagement: null,
    periodEngagementRate: null,
    latestTotalViews: null,
    performanceStatus: null,
  };
}

function factualReport(channels, businessFactChannelCount = 2) {
  return {
    evidenceShape: 'executive_notification_full_channel_v4',
    period: {
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      compareStart: '2026-09-07',
      compareEnd: '2026-09-13',
      comparisonMode: 'previous_period',
      windowDays: 7,
    },
    sourceReportIds: [],
    channelCount: 9,
    businessFactChannelCount,
    channels,
  };
}

test('weekly factual overview keeps Facebook and YouTube Views gained bound to their own channels', () => {
  const channels = LARK_NATIVE_AI_CHANNELS.map(emptyChannel);
  const facebook = channels.find((channel) => channel.channelKey === 'facebook_organic');
  const youtube = channels.find((channel) => channel.channelKey === 'youtube_organic');

  facebook.metrics = [metric({
    metricKey: 'views_gained',
    displayName: 'Views gained',
    currentValue: 17508,
    compareValue: 27195,
  })];
  facebook.hasBusinessFacts = true;

  youtube.metrics = [metric({
    metricKey: 'views_gained',
    displayName: 'Views gained',
    currentValue: 268129,
    compareValue: 168793,
  })];
  youtube.hasBusinessFacts = true;

  const overview = buildLarkWeekly7dFactualOverview(factualReport(channels));

  assert.match(overview, /📘 Facebook Organic — Views gained: 17,508 ครั้ง \(-35\.62% เทียบช่วงก่อน\)/u);
  assert.match(overview, /▶️ YouTube Organic — Views gained: 268,129 ครั้ง \(\+58\.85% เทียบช่วงก่อน\)/u);
  assert.doesNotMatch(overview, /YouTube Organic[^\n]*17,508/u);
  assert.doesNotMatch(overview, /Views gained:\s*[\d,.]+\s*เท่า/iu);
});

test('weekly display keeps KPI metrics and only the highest-ranked content for each Organic channel', () => {
  const channels = LARK_NATIVE_AI_CHANNELS.map(emptyChannel);
  const facebook = channels.find((channel) => channel.channelKey === 'facebook_organic');
  const youtube = channels.find((channel) => channel.channelKey === 'youtube_organic');

  facebook.contentCandidates = [
    content(1, 'Facebook best content', 120000),
    content(2, 'Facebook second content', 80000),
    content(3, 'Facebook third content', 40000),
  ];
  facebook.metrics = [
    metric({
      metricKey: 'views_gained',
      displayName: 'Views gained',
      currentValue: 17508,
      compareValue: 27195,
    }),
    metric({
      metricKey: 'facebook:ranked_content_views:content-1',
      displayName: 'Facebook best content',
      currentValue: 120000,
      compareValue: null,
      rank: 2,
    }),
  ];
  facebook.topContent = facebook.contentCandidates[0];
  facebook.hasBusinessFacts = true;

  youtube.contentCandidates = [
    content(1, 'YouTube best content', 310000),
    content(2, 'YouTube second content', 200000),
  ];
  youtube.metrics = [metric({
    metricKey: 'views_gained',
    displayName: 'Views gained',
    currentValue: 268129,
    compareValue: 168793,
  })];
  youtube.topContent = youtube.contentCandidates[0];
  youtube.hasBusinessFacts = true;

  const sections = buildLarkWeekly7dDisplaySections(factualReport(channels));
  const facebookSection = sections.find((section) => section.channelKey === 'facebook_organic');
  const youtubeSection = sections.find((section) => section.channelKey === 'youtube_organic');

  assert.ok(facebookSection.lines.includes('• Views gained: 17,508 ครั้ง (-35.62% เทียบช่วงก่อน)'));
  assert.ok(facebookSection.lines.includes('• Content #1: Facebook best content — Views 120,000'));
  assert.ok(!facebookSection.lines.includes('• Facebook best content: 120,000'));
  assert.equal(facebookSection.lines.filter((line) => line.includes('Facebook best content')).length, 1);
  assert.ok(!facebookSection.lines.some((line) => line.includes('Content #2:')));
  assert.ok(!facebookSection.lines.some((line) => line.includes('Content #3:')));

  assert.ok(youtubeSection.lines.includes('• Views gained: 268,129 ครั้ง (+58.85% เทียบช่วงก่อน)'));
  assert.ok(youtubeSection.lines.includes('• Content #1: YouTube best content — Views 310,000'));
  assert.ok(!youtubeSection.lines.some((line) => line.includes('Content #2:')));
});

test('factual report builder removes ranked content rows from KPI metrics before rendering', () => {
  const caption = 'แก้ข้ออีก!! แจก promotion ไปเลยจ้า';
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: {
      periodStart: '2026-09-14',
      periodEnd: '2026-09-20',
      compareStart: '2026-09-07',
      compareEnd: '2026-09-13',
      comparisonMode: 'previous_period',
      windowDays: 7,
    },
    reportBundles: [{
      channelKey: 'tiktok_organic',
      reportId: 'tiktok-weekly-source',
      payload: { dataStatus: 'complete' },
      metricValues: [
        {
          metric_key: 'tiktok:ranked_content_views:content-1',
          display_name: caption,
          current_value: 9147,
          compare_value: null,
          metric_scope: 'period_delta',
          dimension_type: 'summary',
          availability_status: 'available',
          unit: 'count',
          rank: 1,
        },
        {
          metric_key: 'tiktok:period_views',
          display_name: 'Views gained',
          current_value: 50000,
          compare_value: 40000,
          metric_scope: 'period_delta',
          dimension_type: 'summary',
          availability_status: 'available',
          unit: 'count',
          rank: 2,
        },
      ],
      topContent: [{
        rank: 1,
        external_content_id: 'content-1',
        caption,
        period_views: 9147,
        period_engagement: 100,
        period_engagement_rate: 0.01,
        period_shares: 2,
      }],
      topAds: [],
    }],
  });

  const tiktok = report.channels.find((channel) => channel.channelKey === 'tiktok_organic');
  assert.deepEqual(tiktok.metrics.map((item) => item.metricKey), ['tiktok:period_views']);

  const section = buildLarkWeekly7dDisplaySections(report)
    .find((item) => item.channelKey === 'tiktok_organic');
  assert.ok(section.lines.includes('• Views gained: 50,000 ครั้ง (+25% เทียบช่วงก่อน)'));
  assert.ok(section.lines.includes(`• Content #1: ${caption} — Views 9,147 | Engagement 100 | ER 0.01% | Shares 2`));
  assert.ok(!section.lines.includes(`• ${caption}: 9,147`));
  assert.equal(section.lines.filter((line) => line.includes(caption)).length, 1);
});

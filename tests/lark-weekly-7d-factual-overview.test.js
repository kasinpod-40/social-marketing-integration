import test from 'node:test';
import assert from 'node:assert/strict';

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

function metric({ metricKey, displayName, currentValue, compareValue }) {
  return {
    metricKey,
    displayName,
    currentValue,
    displayValue: currentValue,
    compareValue,
    changeValue: null,
    changePercent: null,
    unit: 'count',
    rank: 1,
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

  assert.match(overview, /📘 Facebook Organic — Views gained: 17,508 \(-35\.62% เทียบช่วงก่อน\)/u);
  assert.match(overview, /▶️ YouTube Organic — Views gained: 268,129 \(\+58\.85% เทียบช่วงก่อน\)/u);
  assert.doesNotMatch(overview, /YouTube Organic[^\n]*17,508/u);
  assert.doesNotMatch(overview, /Views gained:\s*[\d,.]+\s*เท่า/iu);
});

test('weekly display keeps KPI metrics and only the highest-ranked content for each Organic channel', () => {
  const channels = LARK_NATIVE_AI_CHANNELS.map(emptyChannel);
  const facebook = channels.find((channel) => channel.channelKey === 'facebook_organic');
  const youtube = channels.find((channel) => channel.channelKey === 'youtube_organic');

  facebook.metrics = [metric({
    metricKey: 'views_gained',
    displayName: 'Views gained',
    currentValue: 17508,
    compareValue: 27195,
  })];
  facebook.contentCandidates = [
    content(1, 'Facebook best content', 120000),
    content(2, 'Facebook second content', 80000),
    content(3, 'Facebook third content', 40000),
  ];
  facebook.topContent = facebook.contentCandidates[0];
  facebook.hasBusinessFacts = true;

  youtube.metrics = [metric({
    metricKey: 'views_gained',
    displayName: 'Views gained',
    currentValue: 268129,
    compareValue: 168793,
  })];
  youtube.contentCandidates = [
    content(1, 'YouTube best content', 310000),
    content(2, 'YouTube second content', 200000),
  ];
  youtube.topContent = youtube.contentCandidates[0];
  youtube.hasBusinessFacts = true;

  const sections = buildLarkWeekly7dDisplaySections(factualReport(channels));
  const facebookSection = sections.find((section) => section.channelKey === 'facebook_organic');
  const youtubeSection = sections.find((section) => section.channelKey === 'youtube_organic');

  assert.ok(facebookSection.lines.includes('• Views gained: 17,508 (-35.62% เทียบช่วงก่อน)'));
  assert.ok(facebookSection.lines.includes('• Content #1: Facebook best content — Views 120,000'));
  assert.ok(!facebookSection.lines.some((line) => line.includes('Content #2:')));
  assert.ok(!facebookSection.lines.some((line) => line.includes('Content #3:')));

  assert.ok(youtubeSection.lines.includes('• Views gained: 268,129 (+58.85% เทียบช่วงก่อน)'));
  assert.ok(youtubeSection.lines.includes('• Content #1: YouTube best content — Views 310,000'));
  assert.ok(!youtubeSection.lines.some((line) => line.includes('Content #2:')));
});

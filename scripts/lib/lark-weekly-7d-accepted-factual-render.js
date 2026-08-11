export const LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER_VERSION =
  'lark_weekly_7d_accepted_factual_render_v1';
export const LARK_WEEKLY_7D_ACCEPTED_FACTUAL_REPORT_SHA256 =
  'a732d4c4790ef99261e23e6a129a38822e9268a1f478387dfc2e82126b8a6fea';
export const LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256 =
  'c297f9d510422a68678a03425da1607848f8b8c27aea9d9074dc7cb0c3082edb';

/**
 * Immutable factual rendering for the accepted 2026-08-03..2026-08-09 Weekly report.
 *
 * This contains only deterministic Report rendering, never Native-AI output. The same factual
 * body was already reviewed under factualReportSha256=a732... and is retained in source control
 * because rolling Report Snapshots are not historical delivery storage. Final Insight/Strengths/
 * Weaknesses/Recommendations continue to come from the immutable Fresh v4 Lark AI row.
 */
export const LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER = deepFreeze({
  version: LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER_VERSION,
  factualReportSha256: LARK_WEEKLY_7D_ACCEPTED_FACTUAL_REPORT_SHA256,
  period: {
    periodStart: '2026-08-03',
    periodEnd: '2026-08-09',
    compareStart: '2026-07-27',
    compareEnd: '2026-08-02',
    comparisonMode: 'previous_period',
    windowDays: 7,
  },
  channelSectionsSha256: LARK_WEEKLY_7D_ACCEPTED_CHANNEL_SECTIONS_SHA256,
  channelSections: [
    {
      heading: '🎵 TikTok Organic',
      lines: [
        '• Views gained: 0',
        '• Likes gained: 0',
        '• Comments gained: 0',
        '• Shares gained: 0',
      ],
    },
    {
      heading: '📘 Facebook Organic',
      lines: ['• Followers: 181,448 (+0.2% เทียบช่วงก่อน)'],
    },
    {
      heading: '📸 Instagram Organic',
      lines: [
        '• Views gained: 0',
        '• Likes gained: 0',
        '• Comments gained: 0',
        '• Shares gained: 0',
      ],
    },
    {
      heading: '▶️ YouTube Organic',
      lines: [
        '• Views gained: 0',
        '• Likes gained: 0',
        '• Total views: 34,508,913 (0% เทียบช่วงก่อน)',
        '• Total likes: 307,897 (0% เทียบช่วงก่อน)',
      ],
    },
    {
      heading: '💰 Meta Ads',
      lines: [
        '• Spend: 2,857.35 (-77.81% เทียบช่วงก่อน)',
        '• Impressions: 406,054 (-82.41% เทียบช่วงก่อน)',
        '• Reach: 366,805 (-81.81% เทียบช่วงก่อน)',
        '• Clicks: 5,387 (-81.47% เทียบช่วงก่อน)',
        '• Ad #1: Sale M.5/1 02 — Spend 122.5 | Clicks 57 | Impressions 4,352 | CTR 1.31% | CPC 2.15',
        '• Ad #2: Sale TRI 01 — Spend 113.49 | Clicks 56 | Impressions 3,954 | CTR 1.42% | CPC 2.03',
        '• Ad #3: [7.2025] ขาย Combo สอวน 4990 1D — Spend 106.04 | Clicks 13 | Impressions 4,881 | CTR 0.27% | CPC 8.16',
      ],
    },
    {
      heading: '🔎 Google Ads',
      lines: [
        '• Spend: 8,446.4 (+8.69% เทียบช่วงก่อน)',
        '• Impressions: 274,173 (+29.68% เทียบช่วงก่อน)',
        '• Clicks: 3,035 (-29.91% เทียบช่วงก่อน)',
        '• Conversions: 0 (-100% เทียบช่วงก่อน)',
      ],
    },
    {
      heading: '📣 TikTok Ads',
      lines: ['ยังไม่พบข้อมูลสำหรับช่วงนี้'],
    },
    {
      heading: '🛒 WooCommerce',
      lines: [
        '• Net sales: 209,710 (+19.23% เทียบช่วงก่อน)',
        '• Gross sales: 210,810 (+18.6% เทียบช่วงก่อน)',
        '• Recognized revenue: 209,710 (+19.23% เทียบช่วงก่อน)',
        '• Refunds: 0 (ช่วงก่อน 0)',
      ],
    },
    {
      heading: '💬 Chatwoot',
      lines: [
        '• New conversations: 8 (-71.43% เทียบช่วงก่อน)',
        '• Resolved conversations: 0 (-100% เทียบช่วงก่อน)',
        '• Reopened conversations: 0 (ช่วงก่อน 0)',
        '• Incoming messages: 71 (-79.77% เทียบช่วงก่อน)',
      ],
    },
  ],
});

export function renderAcceptedWeekly7dChannelSections() {
  return LARK_WEEKLY_7D_ACCEPTED_FACTUAL_RENDER.channelSections
    .flatMap(({ heading, lines }) => [heading, ...lines, ''])
    .join('\n')
    .trim();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

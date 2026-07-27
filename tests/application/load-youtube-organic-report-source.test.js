import test from 'node:test';
import assert from 'node:assert/strict';
import { loadYouTubeOrganicReportSource } from '../../packages/application/src/reports/load-youtube-organic-report-source.js';

test('YouTube report application boundary delegates normalized period and limits to source.load', async () => {
  let received = null;
  const source = {
    async load(input) {
      received = input;
      return Object.freeze({ contents: Object.freeze([]), dailySnapshots: Object.freeze([]) });
    },
  };
  const result = await loadYouTubeOrganicReportSource({
    source,
    customerKey: 'integration_workspace',
    accountKey: 'channel_account',
    timeZone: 'Asia/Bangkok',
    period: {
      periodStart: '2026-07-20',
      periodEnd: '2026-07-26',
      compareStart: '2026-07-13',
      compareEnd: '2026-07-19',
    },
    maxContentRecords: 2_000,
    maxAccountRecords: 400,
  });

  assert.equal(result.contents.length, 0);
  assert.deepEqual(received, {
    customerKey: 'integration_workspace',
    accountKey: 'channel_account',
    timeZone: 'Asia/Bangkok',
    periodStart: '2026-07-20',
    periodEnd: '2026-07-26',
    compareStart: '2026-07-13',
    compareEnd: '2026-07-19',
    maxContentRecords: 2_000,
    maxAccountRecords: 400,
  });
});

test('YouTube report application boundary requires a D1 source adapter', async () => {
  await assert.rejects(() => loadYouTubeOrganicReportSource({
    customerKey: 'integration_workspace',
    accountKey: 'channel_account',
    period: { periodStart: '2026-07-20', periodEnd: '2026-07-26' },
  }), /requires source\.load/);
});

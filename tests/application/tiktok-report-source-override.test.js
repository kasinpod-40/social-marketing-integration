import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateTikTokReportContentMetadata } from '../../packages/application/src/reports/hydrate-tiktok-report-content-metadata.js';
import { createTikTokReportSourceOverrideRepository } from '../../packages/application/src/reports/tiktok-report-source-override-repository.js';

const tables = Object.freeze({ mktContent: 'content', mktContentDaily: 'daily' });

test('D1 report override filters source rows and forwards output writes', async () => {
  const calls = [];
  const base = {
    async searchRecords(tableId) {
      calls.push(['search', tableId]);
      return [{ recordId: 'base' }];
    },
    async createMany(tableId, rows) {
      calls.push(['create', tableId, rows.length]);
      return { created: rows.length };
    },
  };
  const repository = createTikTokReportSourceOverrideRepository({
    repository: base,
    tables,
    timeZone: 'Asia/Bangkok',
    contents: [{
      recordId: 'content-1',
      contentKey: 'tiktok:chemistry_k:1',
      accountId: 'chemistry_k',
      externalContentId: '1',
      caption: 'hydrated',
      contentUrl: 'https://example.com/1',
      thumbnailUrl: null,
      publishedAt: null,
    }],
    dailySnapshots: [{
      recordId: 'observation-1',
      contentDailyKey: 'observation-1',
      accountId: 'chemistry_k',
      externalContentId: '1',
      metricDate: '2026-07-25',
      views: 10,
      likes: 1,
      comments: 0,
      shares: 0,
      uniqueViewers: null,
      avgWatchTimeSeconds: null,
      totalWatchTimeSeconds: null,
      completionRate: null,
    }],
  });

  const contentRows = await repository.searchRecords('content', {
    filter: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'account_id', operator: 'is', value: ['chemistry_k'] },
        { fieldName: 'platform', operator: 'is', value: ['tiktok'] },
      ],
    },
  });
  const dailyRows = await repository.searchRecords('daily', {
    filter: {
      conjunction: 'and',
      conditions: [
        { fieldName: 'metric_date', operator: 'isLessEqual', value: [Date.parse('2026-07-25T00:00:00+07:00')] },
      ],
    },
  });
  const output = await repository.createMany('report-output', [{ report_id: 'r1' }]);

  assert.equal(contentRows.length, 1);
  assert.equal(contentRows[0].fields.caption, 'hydrated');
  assert.equal(dailyRows.length, 1);
  assert.equal(output.created, 1);
  assert.deepEqual(calls, [['create', 'report-output', 1]]);
});

test('metadata hydration reads only requested top identities and preserves other D1 rows', async () => {
  const requested = [];
  const repository = {
    async listByFieldValues(_tableId, fieldName, values) {
      requested.push({ fieldName, values: [...values] });
      return [{
        recordId: 'lark-1',
        fields: {
          external_content_id: '1',
          caption: 'Lark caption',
          content_url: 'https://example.com/1',
          thumbnail_url: 'https://example.com/1.jpg',
        },
      }];
    },
  };
  const contents = [
    { externalContentId: '1', caption: null, contentUrl: null, thumbnailUrl: null },
    { externalContentId: '2', caption: null, contentUrl: null, thumbnailUrl: null },
  ];
  const hydrated = await hydrateTikTokReportContentMetadata({
    repository,
    tableId: 'content',
    contents,
    externalContentIds: ['1'],
  });

  assert.deepEqual(requested, [{ fieldName: 'external_content_id', values: ['1'] }]);
  assert.equal(hydrated[0].caption, 'Lark caption');
  assert.equal(hydrated[0].contentUrl, 'https://example.com/1');
  assert.equal(hydrated[1], contents[1]);
});

test('metadata hydration rejects duplicate Lark cache identities', async () => {
  const repository = {
    async listByFieldValues() {
      return [
        { fields: { external_content_id: '1', caption: 'A' } },
        { fields: { external_content_id: '1', caption: 'B' } },
      ];
    },
  };
  await assert.rejects(() => hydrateTikTokReportContentMetadata({
    repository,
    tableId: 'content',
    contents: [{ externalContentId: '1' }],
    externalContentIds: ['1'],
  }), /Duplicate TikTok metadata cache identity/);
});

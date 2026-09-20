import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hydrateReportTopAdsMetadata,
  hydrateReportTopContentMetadata,
} from '../../packages/application/src/reports/hydrate-report-display-metadata.js';

test('hydrates bounded Content display metadata by stable content_key', async () => {
  const calls = [];
  const rows = [{
    content_key: 'facebook:chemistry_k:post-1',
    external_content_id: 'post-1',
    caption: null,
    content_url: null,
    thumbnail_url: null,
  }];
  const result = await hydrateReportTopContentMetadata({
    repository: repository(calls, [{ fields: {
      content_key: [{ text: 'facebook:chemistry_k:post-1' }],
      caption: [{ text: 'โพสต์หนึ่ง' }],
      content_url: [{ text: 'https://example.com/post-1' }],
      thumbnail_url: [{ text: 'https://example.com/post-1.jpg' }],
    } }]),
    tableId: 'content-table',
    rows,
  });

  assert.deepEqual(calls, [{
    tableId: 'content-table',
    fieldName: 'content_key',
    values: ['facebook:chemistry_k:post-1'],
  }]);
  assert.equal(result[0].caption, 'โพสต์หนึ่ง');
  assert.equal(result[0].content_url, 'https://example.com/post-1');
});

test('falls back to platform plus external_content_id when Lark uses provider account in content_key', async () => {
  const calls = [];
  const rows = [{
    platform: 'facebook',
    content_key: 'facebook:chemistry_k:post-1',
    external_content_id: 'post-1',
    caption: null,
    content_url: null,
    thumbnail_url: null,
  }];
  const result = await hydrateReportTopContentMetadata({
    repository: repositorySequence(calls, [
      [],
      [{ fields: {
        platform: 'facebook',
        content_key: 'facebook:982406442148381:post-1',
        external_content_id: 'post-1',
        caption: 'โพสต์จาก Provider Account ID',
        content_url: 'https://example.com/post-1',
      } }],
    ]),
    tableId: 'content-table',
    rows,
  });

  assert.deepEqual(calls, [
    { tableId: 'content-table', fieldName: 'content_key', values: ['facebook:chemistry_k:post-1'] },
    { tableId: 'content-table', fieldName: 'external_content_id', values: ['post-1'] },
  ]);
  assert.equal(result[0].caption, 'โพสต์จาก Provider Account ID');
});

test('uses a truthful platform label when a real Content row has no source caption', async () => {
  const rows = [{
    platform: 'facebook',
    content_key: 'facebook:chemistry_k:982406442148381_901351569442453',
    external_content_id: '982406442148381_901351569442453',
    caption: null,
    content_url: 'https://www.facebook.com/posts/901351569442453',
  }];
  const result = await hydrateReportTopContentMetadata({
    repository: repositorySequence([], [
      [],
      [{ fields: {
        platform: 'facebook',
        external_content_id: '982406442148381_901351569442453',
        caption: null,
        content_url: 'https://www.facebook.com/posts/901351569442453',
      } }],
    ]),
    tableId: 'content-table',
    rows,
  });

  assert.equal(result[0].caption, 'โพสต์ Facebook #901351569442453 (ไม่มีข้อความ)');
  assert.equal(result[0].content_url, 'https://www.facebook.com/posts/901351569442453');
});

test('hydrates more than the former 100-row display limit', async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    platform: 'youtube',
    content_key: `youtube:chemistry_k:video-${index + 1}`,
    external_content_id: `video-${index + 1}`,
    caption: `Video ${index + 1}`,
  }));
  const calls = [];
  const result = await hydrateReportTopContentMetadata({
    repository: repository(calls, []),
    tableId: 'content-table',
    rows,
  });

  assert.equal(result.length, 101);
  assert.equal(calls[0].values.length, 101);
});

test('hydrates Ad names by canonical ads_ad_key without using current status as a filter', async () => {
  const calls = [];
  const rows = [{ external_ad_id: 'ad-1', ad_name: null, spend_micros: 100 }];
  const result = await hydrateReportTopAdsMetadata({
    repository: repository(calls, [{ fields: {
      ads_ad_key: 'meta_ads:chemistry_k:ad:ad-1',
      ad_name: 'โฆษณาที่หยุดแล้วแต่มีผลงานในช่วง',
      status: 'PAUSED',
    } }]),
    tableId: 'ads-table',
    platform: 'meta_ads',
    accountId: 'chemistry_k',
    rows,
  });

  assert.deepEqual(calls, [{
    tableId: 'ads-table',
    fieldName: 'ads_ad_key',
    values: ['meta_ads:chemistry_k:ad:ad-1'],
  }]);
  assert.equal(result[0].ad_name, 'โฆษณาที่หยุดแล้วแต่มีผลงานในช่วง');
});

test('duplicate stable metadata identities fail closed', async () => {
  const duplicate = { fields: { content_key: 'facebook:chemistry_k:post-1', caption: 'ซ้ำ' } };
  await assert.rejects(() => hydrateReportTopContentMetadata({
    repository: repository([], [duplicate, duplicate]),
    tableId: 'content-table',
    rows: [{ content_key: 'facebook:chemistry_k:post-1' }],
  }), /Duplicate Lark display metadata identity/u);
});

function repository(calls, records) {
  return {
    async listByFieldValues(tableId, fieldName, values) {
      calls.push({ tableId, fieldName, values: [...values] });
      return records;
    },
  };
}

function repositorySequence(calls, responses) {
  let index = 0;
  return {
    async listByFieldValues(tableId, fieldName, values) {
      calls.push({ tableId, fieldName, values: [...values] });
      return responses[index++] ?? [];
    },
  };
}

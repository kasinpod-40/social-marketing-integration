import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeExistingRecordsForComparison, serializeRowsForLark } from '../../packages/connectors/src/lark/lark-field-serializer.js';

const fields = [
  { fieldName: 'content_key', type: 1 },
  { fieldName: 'content_url', type: 15 },
  { fieldName: 'thumbnail_url', type: 15 },
  { fieldName: 'views', type: 2 },
  { fieldName: 'published_at', type: 5 },
];

test('serializes URL fields into Lark URL payloads and omits empty optional URLs', () => {
  const [row] = serializeRowsForLark([{
    content_key: 'tiktok:chemistry_k:1',
    content_url: 'https://www.tiktok.com/@chemistry_k/video/1',
    thumbnail_url: null,
    views: '12',
    published_at: '2026-07-10T00:00:00Z',
  }], fields, { tableId: 'tbl_content', keyField: 'content_key' });

  assert.deepEqual(row.content_url, {
    link: 'https://www.tiktok.com/@chemistry_k/video/1',
    text: 'https://www.tiktok.com/@chemistry_k/video/1',
  });
  assert.equal('thumbnail_url' in row, false);
  assert.equal(row.views, 12);
  assert.equal(row.published_at, Date.parse('2026-07-10T00:00:00Z'));
});

test('fails before writes with table, key, and field context for invalid URL', () => {
  assert.throws(
    () => serializeRowsForLark([{
      content_key: 'tiktok:chemistry_k:1',
      content_url: 'not-a-url',
    }], fields, { tableId: 'tbl_content', keyField: 'content_key' }),
    /table=tbl_content, content_key=tiktok:chemistry_k:1, field=content_url/,
  );
});

test('fails before writes when mapping includes a field missing from Lark', () => {
  assert.throws(
    () => serializeRowsForLark([{ content_key: 'one', unknown_field: 'x' }], fields, {
      tableId: 'tbl_content', keyField: 'content_key',
    }),
    /field=unknown_field: field does not exist/,
  );
});

test('serializes numeric epoch strings and epoch seconds into milliseconds', () => {
  const [numericString] = serializeRowsForLark([{
    content_key: 'tiktok:chemistry_k:2',
    published_at: '1783328400000',
  }], fields, { tableId: 'tbl_content', keyField: 'content_key' });

  const [seconds] = serializeRowsForLark([{
    content_key: 'tiktok:chemistry_k:3',
    published_at: 1783328400,
  }], fields, { tableId: 'tbl_content', keyField: 'content_key' });

  assert.equal(numericString.published_at, 1783328400000);
  assert.equal(seconds.published_at, 1783328400000);
});

test('rejects ambiguous timezone-less date strings before writes', () => {
  assert.throws(
    () => serializeRowsForLark([{
      content_key: 'tiktok:chemistry_k:4',
      published_at: '2026-07-10 12:00:00',
    }], fields, { tableId: 'tbl_content', keyField: 'content_key' }),
    /explicit timezone/,
  );
});


test('validates single-select and multi-select values against live schema options', () => {
  const fields = [
    { fieldName: 'platform', type: 3, property: { options: [{ name: 'tiktok' }] } },
    { fieldName: 'course_level', type: 4, property: { options: [{ name: 'ม.4' }] } },
  ];
  assert.deepEqual(serializeRowsForLark([{ platform: 'tiktok', course_level: ['ม.4'] }], fields), [
    { platform: 'tiktok', course_level: ['ม.4'] },
  ]);
  assert.throws(
    () => serializeRowsForLark([{ platform: 'youtube', course_level: ['DEK73'] }], fields),
    /not configured in destination select options/,
  );
});


test('normalizes existing rich text, URL, and unordered multi-select values without false updates', () => {
  const comparisonFields = [
    { fieldName: 'content_key', type: 1 },
    { fieldName: 'caption', type: 1 },
    { fieldName: 'content_url', type: 15 },
    { fieldName: 'course_level', type: 4, property: { options: [{ name: 'ม.4' }, { name: 'ม.5' }] } },
  ];

  const [record] = normalizeExistingRecordsForComparison([{
    record_id: 'rec1',
    fields: {
      content_key: [{ text: 'key-1', type: 'text' }],
      caption: [{ text: 'บทเรียนเคมี', type: 'text' }],
      content_url: [{ link: 'https://example.com', text: 'เปิดเนื้อหา', type: 'url' }],
      course_level: [{ name: 'ม.5' }, { name: 'ม.4' }, { name: 'ม.5' }],
    },
  }], comparisonFields, {
    tableId: 'tbl_content',
    incomingFieldNames: ['content_key', 'caption', 'content_url', 'course_level'],
  });

  assert.deepEqual(record, {
    recordId: 'rec1',
    fields: {
      content_key: 'key-1',
      caption: 'บทเรียนเคมี',
      content_url: { link: 'https://example.com/', text: 'เปิดเนื้อหา' },
      course_level: ['ม.4', 'ม.5'],
    },
  });
});

test('omits empty multi-select values so empty Lark cells do not trigger false updates', () => {
  const selectFields = [
    { fieldName: 'content_key', type: 1 },
    { fieldName: 'course_level', type: 4, property: { options: [{ name: 'ม.4' }] } },
  ];
  const [row] = serializeRowsForLark([{
    content_key: 'key-1',
    course_level: [],
  }], selectFields, { tableId: 'tbl_content', keyField: 'content_key' });

  assert.deepEqual(row, { content_key: 'key-1' });
});


test('trims the stable key in the prepared payload so lookup and write use the same identity', () => {
  const row = serializeRowsForLark([
    { content_key: '  tiktok:account:video_1  ' },
  ], fields, { tableId: 'tbl_content', keyField: 'content_key' })[0];

  assert.equal(row.content_key, 'tiktok:account:video_1');
});


test('preserves URL display text during comparison so custom labels do not update forever', () => {
  const existing = normalizeExistingRecordsForComparison([{
    recordId: 'rec_url',
    fields: {
      content_key: 'tiktok:a:v1',
      content_url: [{ link: 'https://example.com/video', text: 'เปิดวิดีโอ' }],
    },
  }], fields, {
    tableId: 'tbl_content',
    incomingFieldNames: ['content_key', 'content_url'],
  });

  assert.deepEqual(existing[0].fields.content_url, {
    link: 'https://example.com/video',
    text: 'เปิดวิดีโอ',
  });
});

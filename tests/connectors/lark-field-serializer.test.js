import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeRowsForLark } from '../../packages/connectors/src/lark/lark-field-serializer.js';

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

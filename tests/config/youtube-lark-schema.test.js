import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_LEGACY_RAW_LARK_SCHEMA,
  YOUTUBE_LARK_SCHEMA,
  YOUTUBE_LARK_SCHEMA_VERSION,
  validateYouTubeLarkSchema,
} from '../../packages/config/src/youtube-lark-schema.js';

test('provisions no YouTube RAW tables while retaining exact legacy cleanup metadata', () => {
  assert.equal(validateYouTubeLarkSchema(), true);
  assert.equal(YOUTUBE_LARK_SCHEMA.length, 0);
  assert.match(YOUTUBE_LARK_SCHEMA_VERSION, /d1-raw/u);
  assert.deepEqual(YOUTUBE_LEGACY_RAW_LARK_SCHEMA.map((table) => table.createName), [
    '📺 RAW_YouTube_Channels',
    '🎬 RAW_YouTube_Videos',
    '📊 RAW_YouTube_Analytics_Daily',
  ]);
  const allFields = YOUTUBE_LEGACY_RAW_LARK_SCHEMA.flatMap((table) => table.fields);
  assert.equal(allFields.length, 42);
  assert.ok(allFields.every((field) => field.manageDescription === true));
  assert.ok(allFields.every((field) => /[ก-๙]/u.test(field.description)));
  const urlFields = YOUTUBE_LEGACY_RAW_LARK_SCHEMA.flatMap((table) => table.fields)
    .filter((field) => field.type === 15);
  assert.ok(urlFields.length > 0);
  assert.ok(urlFields.every((field) => field.uiType === 'Url'));
  const dateTimeFields = allFields.filter((field) => field.type === 5);
  assert.equal(dateTimeFields.length, 6);
  assert.deepEqual(
    dateTimeFields.map((field) => field.fieldName),
    ['fetched_at', 'published_at', 'last_seen_at', 'missing_since', 'fetched_at', 'fetched_at'],
  );
  assert.ok(dateTimeFields.every((field) => field.uiType === 'DateTime'));
  assert.ok(dateTimeFields.every((field) => (
    field.property?.date_formatter === 'yyyy/MM/dd HH:mm'
    && field.property?.auto_fill === false
  )));
});

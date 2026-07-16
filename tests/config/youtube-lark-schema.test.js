import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_LARK_SCHEMA,
  YOUTUBE_LARK_SCHEMA_VERSION,
  validateYouTubeLarkSchema,
} from '../../packages/config/src/youtube-lark-schema.js';
import { planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';

test('derives three installable YouTube RAW tables from the approved Blueprint', async () => {
  assert.equal(validateYouTubeLarkSchema(), true);
  assert.equal(YOUTUBE_LARK_SCHEMA.length, 3);
  assert.deepEqual(YOUTUBE_LARK_SCHEMA.map((table) => table.createName), [
    '📺 RAW_YouTube_Channels',
    '🎬 RAW_YouTube_Videos',
    '📊 RAW_YouTube_Analytics_Daily',
  ]);
  const allFields = YOUTUBE_LARK_SCHEMA.flatMap((table) => table.fields);
  assert.equal(allFields.length, 42);
  assert.ok(allFields.every((field) => field.manageDescription === true));
  assert.ok(allFields.every((field) => /[ก-๙]/u.test(field.description)));
  const urlFields = YOUTUBE_LARK_SCHEMA.flatMap((table) => table.fields)
    .filter((field) => field.type === 15);
  assert.ok(urlFields.length > 0);
  assert.ok(urlFields.every((field) => field.uiType === 'Url'));
  const client = {
    async listTables() { return []; },
    async listFields() { throw new Error('not expected'); },
    async createTable() { throw new Error('not expected'); },
    async createField() { throw new Error('not expected'); },
    async updateField() { throw new Error('not expected'); },
  };
  const preview = await planLarkSchema({
    client,
    env: {},
    schema: YOUTUBE_LARK_SCHEMA,
    schemaVersion: YOUTUBE_LARK_SCHEMA_VERSION,
    validateSchema: validateYouTubeLarkSchema,
  });
  assert.equal(preview.schemaVersion, YOUTUBE_LARK_SCHEMA_VERSION);
  assert.equal(preview.readyToApply, true);
  assert.equal(preview.actions.filter((action) => action.kind === 'create_table').length, 3);
  assert.equal(preview.actions.reduce((sum, action) => sum + action.fields.length, 0), 42);
});

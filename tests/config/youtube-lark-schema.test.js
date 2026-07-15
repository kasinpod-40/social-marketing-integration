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

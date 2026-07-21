import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_TABLE_GOVERNANCE_VERSION,
  PROTECTED_LARK_TABLES,
  assertSchemaDoesNotTargetProtectedTables,
  canonicalTableName,
  findProtectedLarkTableMatch,
} from '../../packages/config/src/lark-table-governance.js';
import { planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';

test('locks the Lark Native TikTok table as a read-only external source', () => {
  assert.equal(LARK_TABLE_GOVERNANCE_VERSION, 'lark-table-governance-v1');
  assert.deepEqual(PROTECTED_LARK_TABLES.map((table) => table.logicalName), ['RAW_TikTok_Creator_Videos']);
  assert.equal(PROTECTED_LARK_TABLES[0].accessMode, 'read_only_source');
  assert.match(PROTECTED_LARK_TABLES[0].mutationPolicy, /deny_all_schema/u);
  assert.equal(canonicalTableName('🎵 RAW_TikTok_Creator_Videos'), 'raw_tiktok_creator_videos');
});

test('detects protected tables by key, logical name, create name and aliases', () => {
  assert.equal(findProtectedLarkTableMatch({ key: 'rawTikTokCreatorVideos' })?.owner, 'lark_native_tiktok_for_creator');
  assert.equal(findProtectedLarkTableMatch({ logicalName: 'RAW_TikTok_Creator_Videos' })?.key, 'rawTikTokCreatorVideos');
  assert.equal(findProtectedLarkTableMatch({ createName: '🎵 RAW_TikTok_Creator_Videos' })?.key, 'rawTikTokCreatorVideos');
  assert.equal(findProtectedLarkTableMatch({ aliases: ['🧪 RAW_TikTok_Creator_Videos'] })?.key, 'rawTikTokCreatorVideos');
  assert.equal(findProtectedLarkTableMatch({ logicalName: 'RAW_YouTube_Videos' }), null);
});

test('generic schema planning fails before any live table read when protected table is targeted', async () => {
  let listTablesCalls = 0;
  const client = {
    async listTables() { listTablesCalls += 1; return []; },
    async listFields() { throw new Error('not expected'); },
    async createTable() { throw new Error('not expected'); },
    async createField() { throw new Error('not expected'); },
    async updateField() { throw new Error('not expected'); },
  };
  const schema = [{
    key: 'unsafe', logicalName: 'RAW_TikTok_Creator_Videos', createName: '🎵 RAW_TikTok_Creator_Videos',
    aliases: ['RAW_TikTok_Creator_Videos'], envName: 'LARK_TABLE_UNSAFE', defaultViewName: 'All',
    fields: [{ fieldName: 'id', type: 1, primary: true }],
  }];
  await assert.rejects(
    () => planLarkSchema({ client, schema, validateSchema: () => true, schemaVersion: 'test' }),
    (error) => error?.code === 'LARK_PROTECTED_TABLE_MUTATION_BLOCKED',
  );
  assert.equal(listTablesCalls, 0);
  assert.throws(() => assertSchemaDoesNotTargetProtectedTables(schema), (error) => error?.code === 'LARK_PROTECTED_TABLE_MUTATION_BLOCKED');
});

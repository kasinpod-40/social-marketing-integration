import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { previewSharedTableLarkSchema } from '../../packages/application/src/use-cases/preview-shared-table-lark-schema.js';
import {
  SHARED_TABLE_LARK_SCHEMA_VERSION,
  buildSharedTableLarkSchemaFromCsv,
  buildSharedTableViewContractFromCsv,
  validateSharedTableLarkSchema,
} from '../../packages/config/src/shared-table-lark-schema.js';
import { applyLarkSchema, planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';

const ROOT = new URL('../../', import.meta.url);
const DIR = 'docs/shared-table-blueprint-v0.12.1/';
const REUSE = Object.freeze([
  ['RAW_TikTok_Business_Campaigns', 'tbl_campaigns'],
  ['RAW_TikTok_Business_AdGroups', 'tbl_adgroups'],
  ['RAW_TikTok_Business_Ads', 'tbl_ads'],
  ['RAW_Google_Campaigns', 'tbl_google_campaigns'],
  ['RAW_Google_Customer_Lists', 'tbl_google_lists'],
]);

async function loadContract() {
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv, viewPlanCsv] = await Promise.all([
    read('table-inventory.csv'), read('fields.csv'), read('migration-map.csv'), read('view-plan.csv'),
  ]);
  return {
    schema: buildSharedTableLarkSchemaFromCsv({ tableInventoryCsv, fieldsCsv, migrationMapCsv }),
    views: buildSharedTableViewContractFromCsv({ viewPlanCsv }),
  };
}

function read(name) {
  return readFile(new URL(`${DIR}${name}`, ROOT), 'utf8');
}

test('customer-facing preview plans only two canonical tables while protecting TikTok Native', async () => {
  const { schema, views } = await loadContract();
  const calls = [];
  const client = createPreviewClient({ calls });
  const result = await previewSharedTableLarkSchema({
    client,
    env: {},
    schema,
    views,
    schemaVersion: SHARED_TABLE_LARK_SCHEMA_VERSION,
    validateSchema: validateSharedTableLarkSchema,
  });
  assert.equal(result.readyForApplyAuthorization, true);
  assert.equal(result.requiresManualSchemaResolution, false);
  assert.equal(result.applyImplemented, false);
  assert.equal(result.summary.renameTables, 0);
  assert.equal(result.summary.createTables, 2);
  assert.equal(result.summary.createFields, 0);
  assert.equal(result.summary.updateFields, 0);
  assert.equal(result.summary.updatePrimaryFields, 0);
  assert.equal(result.summary.createViews, 0);
  assert.equal(result.summary.protectedActions, 0);
  assert.equal(result.summary.deleteActions, 0);
  assert.equal(result.summary.recordWrites, 0);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.summary.blockingManualActions, 0);
  assert.equal(result.protectedChecks[0].logicalName, 'RAW_TikTok_Creator_Videos');
  assert.equal(result.protectedChecks[0].found, true);
  assert.equal(result.protectedChecks[0].plannedActions, 0);
  assert.equal(calls.filter(([method]) => method === 'listRecordsPage').length, 0);
  assert.ok(calls.every(([method]) => !['createTable', 'createField', 'updateField', 'createView', 'updateView'].includes(method)));
});


test('legacy RAW primary metadata does not enter the customer-facing install plan', async () => {
  const { schema, views } = await loadContract();
  const client = createPreviewClient({ withPrimaryFields: true });
  const result = await previewSharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.readyForApplyAuthorization, true);
  assert.equal(result.requiresManualSchemaResolution, false);
  assert.equal(result.summary.renameTables, 0);
  assert.equal(result.summary.updatePrimaryFields, 0);
  assert.equal(result.summary.createFields, 0);
  assert.equal(result.summary.blockingManualActions, 0);
  assert.equal(result.actions.filter((action) => action.kind === 'update_primary_field').length, 0);
  assert.equal(result.reuseChecks.length, 0);
});

test('legacy RAW record counts do not block the customer-facing install plan', async () => {
  const { schema, views } = await loadContract();
  const client = createPreviewClient({ nonEmptyTableId: 'tbl_ads' });
  const result = await previewSharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.readyForApplyAuthorization, true);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.summary.renameTables, 0);
  assert.equal(result.summary.recordWrites, 0);
});

test('legacy RAW names do not create duplicate-target conflicts', async () => {
  const { schema, views } = await loadContract();
  const client = createPreviewClient({
    additionalTables: [{ tableId: 'tbl_duplicate_target', name: 'RAW_Ads_Daily' }],
  });
  const result = await previewSharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.readyForApplyAuthorization, true);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.summary.createTables, 2);
});

test('generic schema preview now accepts a truly read-only planning client while apply still requires write methods', async () => {
  const schema = [{
    key: 'example', logicalName: 'Example', createName: 'Example', aliases: ['Example'],
    defaultViewName: 'Grid', envName: 'LARK_TABLE_EXAMPLE',
    fields: [{ fieldName: 'key', type: 1, uiType: 'Text', primary: true }],
  }];
  const client = { async listTables() { return []; }, async listFields() { return []; } };
  const validateSchema = () => true;
  const preview = await planLarkSchema({ client, env: {}, schema, validateSchema });
  assert.equal(preview.summary.createTables, 1);
  await assert.rejects(() => applyLarkSchema({ client, env: {}, schema, validateSchema }), /Schema apply requires client\.createTable/u);
});

function createPreviewClient(input = {}) {
  const calls = input.calls ?? [];
  const tables = [
    { tableId: 'tbl_tiktok_native', name: '🎵 RAW_TikTok_Creator_Videos' },
    ...REUSE.map(([name, tableId]) => ({ tableId, name: `🧪 ${name}` })),
    ...(input.additionalTables ?? []),
  ];
  return {
    async listTables() { calls.push(['listTables']); return structuredClone(tables); },
    async listFields({ tableId }) {
      calls.push(['listFields', tableId]);
      if (!input.withPrimaryFields || tableId === 'tbl_tiktok_native') return [];
      return [{
        fieldId: `fld_primary_${tableId}`,
        fieldName: `legacy_key_${tableId}`,
        type: 1,
        isPrimary: true,
        property: null,
        description: '',
      }];
    },
    async listViews({ tableId }) {
      calls.push(['listViews', tableId]);
      return [{ viewId: `view_${tableId}`, viewName: '📋 All Records', viewType: 'grid', property: null }];
    },
    async listRecordsPage({ tableId, pageSize, includeRecordMetadata }) {
      calls.push(['listRecordsPage', tableId, pageSize, includeRecordMetadata]);
      const nonEmpty = input.nonEmptyTableId === tableId;
      return { records: nonEmpty ? [{ recordId: 'rec_1', fields: {} }] : [], hasMore: false, nextPageToken: null };
    },
  };
}

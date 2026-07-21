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

test('offline-style metadata keeps primary-field review as a blocker while protecting TikTok Native', async () => {
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
  assert.equal(result.readyForApplyAuthorization, false);
  assert.equal(result.requiresManualSchemaResolution, true);
  assert.equal(result.applyImplemented, false);
  assert.equal(result.summary.renameTables, 5);
  assert.equal(result.summary.createTables, 2);
  assert.equal(result.summary.createFields, 99);
  assert.equal(result.summary.updateFields, 0);
  assert.equal(result.summary.updatePrimaryFields, 0);
  assert.equal(result.summary.createViews, 17);
  assert.equal(result.summary.protectedActions, 0);
  assert.equal(result.summary.deleteActions, 0);
  assert.equal(result.summary.recordWrites, 0);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.summary.blockingManualActions, 5);
  assert.equal(result.protectedChecks[0].logicalName, 'RAW_TikTok_Creator_Videos');
  assert.equal(result.protectedChecks[0].found, true);
  assert.equal(result.protectedChecks[0].plannedActions, 0);
  assert.equal(calls.filter(([method]) => method === 'listRecordsPage').length, 5);
  assert.ok(calls.every(([method]) => !['createTable', 'createField', 'updateField', 'createView', 'updateView'].includes(method)));
});


test('authoritative live primary metadata plans safe primary renames and removes manual blockers', async () => {
  const { schema, views } = await loadContract();
  const client = createPreviewClient({ withPrimaryFields: true });
  const result = await previewSharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.readyForApplyAuthorization, true);
  assert.equal(result.requiresManualSchemaResolution, false);
  assert.equal(result.summary.renameTables, 5);
  assert.equal(result.summary.updatePrimaryFields, 5);
  assert.equal(result.summary.createFields, 94);
  assert.equal(result.summary.blockingManualActions, 0);
  assert.equal(result.actions.filter((action) => action.kind === 'update_primary_field').length, 5);
  assert.ok(result.reuseChecks.every((check) => check.primaryFieldResolution === 'rename_planned'));
});

test('fails readiness when any reuse source contains a record', async () => {
  const { schema, views } = await loadContract();
  const client = createPreviewClient({ nonEmptyTableId: 'tbl_ads' });
  const result = await previewSharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.readyForApplyAuthorization, false);
  assert.ok(result.conflicts.some((conflict) => conflict.code === 'SHARED_TABLE_REUSE_SOURCE_NOT_EMPTY' && conflict.tableId === 'tbl_ads'));
  assert.equal(result.summary.renameTables, 4);
  assert.equal(result.summary.recordWrites, 0);
});

test('detects duplicate target table instead of planning another table', async () => {
  const { schema, views } = await loadContract();
  const client = createPreviewClient({
    additionalTables: [{ tableId: 'tbl_duplicate_target', name: 'RAW_Ads_Daily' }],
  });
  const result = await previewSharedTableLarkSchema({ client, env: {}, schema, views });
  assert.equal(result.readyForApplyAuthorization, false);
  assert.ok(result.conflicts.some((conflict) => conflict.code === 'AMBIGUOUS_TABLE_NAME'));
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

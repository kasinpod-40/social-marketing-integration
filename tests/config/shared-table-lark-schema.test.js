import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT,
  SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT,
  SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS,
  buildSharedTableLarkSchemaFromCsv,
  buildSharedTableViewContractFromCsv,
  buildSharedTableViewInstallerContract,
  validateSharedTableLarkSchema,
} from '../../packages/config/src/shared-table-lark-schema.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';

const ROOT = new URL('../../', import.meta.url);
const DIR = 'docs/shared-table-blueprint-v0.12.1/';

async function read(name) {
  return readFile(new URL(`${DIR}${name}`, ROOT), 'utf8');
}

async function loadContract() {
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv, viewPlanCsv] = await Promise.all([
    read('table-inventory.csv'), read('fields.csv'), read('migration-map.csv'), read('view-plan.csv'),
  ]);
  return {
    schema: buildSharedTableLarkSchemaFromCsv({ tableInventoryCsv, fieldsCsv, migrationMapCsv }),
    views: buildSharedTableViewContractFromCsv({ viewPlanCsv }),
  };
}

test('derives seven shared tables and 128 fields from the approved CSV contract', async () => {
  const { schema, views } = await loadContract();
  assert.equal(validateSharedTableLarkSchema(schema), true);
  assert.equal(schema.length, SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT);
  assert.equal(schema.flatMap((table) => table.fields).length, SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT);
  assert.equal(SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS.length, 7);
  assert.ok(SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS.every((key) => typeof LARK_TABLE_ENV[key] === 'string'));
  assert.equal(schema.filter((table) => table.sharedTable.physicalAction === 'rename_reuse_in_place').length, 5);
  assert.equal(schema.filter((table) => table.sharedTable.physicalAction === 'create_new').length, 2);
  assert.equal(views.length, 17);
});

test('keeps current empty-table aliases for in-place reuse and no alias for new tables', async () => {
  const { schema } = await loadContract();
  const byName = new Map(schema.map((table) => [table.logicalName, table]));
  assert.deepEqual(byName.get('RAW_Meta_Organic_Accounts').aliases, [
    'RAW_Meta_Organic_Accounts', 'RAW_TikTok_Business_Campaigns',
  ]);
  assert.deepEqual(byName.get('RAW_Ads_Daily').aliases, [
    'RAW_Ads_Daily', 'RAW_Google_Customer_Lists',
  ]);
  assert.deepEqual(byName.get('MKT_Account_Daily').aliases, ['MKT_Account_Daily']);
  assert.equal(byName.get('RAW_Meta_Organic_Accounts').sharedTable.preserveTableId, true);
  assert.equal(byName.get('MKT_Ads_Ads').sharedTable.preserveTableId, false);
});

test('preserves field types, options, dates and reference metadata', async () => {
  const { schema } = await loadContract();
  const byName = new Map(schema.map((table) => [table.logicalName, new Map(table.fields.map((field) => [field.fieldName, field]))]));
  const content = byName.get('RAW_Meta_Organic_Content');
  assert.equal(content.get('raw_content_key').primary, true);
  assert.deepEqual(content.get('platform').property.options.map((option) => option.name), ['facebook', 'instagram']);
  assert.equal(content.get('published_at').property.date_formatter, 'yyyy/MM/dd HH:mm');
  assert.equal(content.get('permalink_url').type, 15);
  assert.equal(content.get('source_account_id').relationTarget, 'RAW_Meta_Organic_Accounts');
  const adsDaily = byName.get('RAW_Ads_Daily');
  assert.equal(adsDaily.get('metric_date').property.date_formatter, 'yyyy/MM/dd');
  assert.equal(adsDaily.get('spend_micros').type, 2);
});

test('rejects incomplete or unexpected shared-table CSV contracts', async () => {
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv] = await Promise.all([
    read('table-inventory.csv'), read('fields.csv'), read('migration-map.csv'),
  ]);
  assert.throws(() => buildSharedTableLarkSchemaFromCsv({
    tableInventoryCsv,
    fieldsCsv: fieldsCsv.replace(/^RAW_Meta_Organic_Accounts,1,.*\r?\n/mu, ''),
    migrationMapCsv,
  }), (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID');
  assert.throws(() => buildSharedTableLarkSchemaFromCsv({
    tableInventoryCsv,
    fieldsCsv: `${fieldsCsv}RAW_Unexpected,1,key,Text,Yes,No,Primary,,,,,,\n`,
    migrationMapCsv,
  }), (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID');
});


test('builds the 17 filtered Views with the shared Report View resolver contract', async () => {
  const { schema, views } = await loadContract();
  const contract = buildSharedTableViewInstallerContract({ schema, views });
  assert.equal(contract.length, 5);
  assert.equal(contract.flatMap((table) => table.views).length, 17);
  const entities = contract.find((table) => table.tableKey === 'rawAdsEntities');
  const metaCampaigns = entities.views.find((view) => view.name === 'Meta Campaigns');
  assert.deepEqual(metaCampaigns.filterInfo, {
    conjunction: 'and',
    conditions: [
      { fieldName: 'platform', operator: 'is', value: 'meta_ads' },
      { fieldName: 'entity_type', operator: 'is', value: 'campaign' },
    ],
  });
  assert.deepEqual(metaCampaigns.hiddenFields, []);
});

test('rejects unsupported or unknown Shared-table View filters', async () => {
  const { schema, views } = await loadContract();
  assert.throws(
    () => buildSharedTableViewInstallerContract({
      schema,
      views: [{ ...views[0], filter: 'platform!=facebook' }],
    }),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );
  assert.throws(
    () => buildSharedTableViewInstallerContract({
      schema,
      views: [{ ...views[0], filter: 'missing_field=facebook' }],
    }),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );
});

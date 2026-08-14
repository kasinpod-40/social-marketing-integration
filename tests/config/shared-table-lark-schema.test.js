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

test('derives only the two customer-facing shared tables from the approved CSV contract', async () => {
  const { schema, views } = await loadContract();
  assert.equal(validateSharedTableLarkSchema(schema), true);
  assert.equal(schema.length, SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT);
  assert.equal(schema.flatMap((table) => table.fields).length, SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT);
  assert.equal(SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS.length, 2);
  assert.ok(SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS.every((key) => typeof LARK_TABLE_ENV[key] === 'string'));
  assert.equal(schema.filter((table) => table.sharedTable.physicalAction === 'rename_reuse_in_place').length, 0);
  assert.equal(schema.filter((table) => table.sharedTable.physicalAction === 'create_new').length, 2);
  assert.equal(views.length, 0);
});

test('does not provision legacy RAW aliases in the customer-facing schema', async () => {
  const { schema } = await loadContract();
  const byName = new Map(schema.map((table) => [table.logicalName, table]));
  assert.equal(byName.has('RAW_Meta_Organic_Accounts'), false);
  assert.equal(byName.has('RAW_Ads_Daily'), false);
  assert.deepEqual(byName.get('MKT_Account_Daily').aliases, ['MKT_Account_Daily']);
  assert.equal(byName.get('MKT_Ads_Ads').sharedTable.preserveTableId, false);
});

test('preserves customer-facing field types, options, dates and reference metadata', async () => {
  const { schema } = await loadContract();
  const byName = new Map(schema.map((table) => [table.logicalName, new Map(table.fields.map((field) => [field.fieldName, field]))]));
  const accountDaily = byName.get('MKT_Account_Daily');
  assert.equal(accountDaily.get('account_daily_key').primary, true);
  assert.deepEqual(accountDaily.get('platform').property.options.map((option) => option.name), [
    'facebook', 'instagram', 'tiktok', 'youtube',
  ]);
  assert.equal(accountDaily.get('metric_date').property.date_formatter, 'yyyy/MM/dd');
  assert.equal(accountDaily.get('account_key').relationTarget, 'MKT_Accounts');
  const ads = byName.get('MKT_Ads_Ads');
  assert.equal(ads.get('landing_page_url').type, 15);
  assert.equal(ads.get('organic_content_id').relationTarget, 'MKT_Content');
});

test('rejects incomplete or unexpected shared-table CSV contracts', async () => {
  const [tableInventoryCsv, fieldsCsv, migrationMapCsv] = await Promise.all([
    read('table-inventory.csv'), read('fields.csv'), read('migration-map.csv'),
  ]);
  assert.throws(() => buildSharedTableLarkSchemaFromCsv({
    tableInventoryCsv,
    fieldsCsv: fieldsCsv.replace(/^MKT_Account_Daily,1,.*\r?\n/mu, ''),
    migrationMapCsv,
  }), (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID');
  assert.throws(() => buildSharedTableLarkSchemaFromCsv({
    tableInventoryCsv,
    fieldsCsv: `${fieldsCsv}RAW_Unexpected,1,key,Text,Yes,No,Primary,,,,,,\n`,
    migrationMapCsv,
  }), (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID');
});


test('does not install legacy RAW Views in the customer-facing schema', async () => {
  const { schema, views } = await loadContract();
  const contract = buildSharedTableViewInstallerContract({ schema, views });
  assert.equal(contract.length, 0);
  assert.equal(contract.flatMap((table) => table.views).length, 0);
});

test('rejects unsupported or unknown Shared-table View filters', async () => {
  const { schema } = await loadContract();
  const accountDailyView = {
    table: 'MKT_Account_Daily',
    viewName: 'Facebook Daily',
    filter: 'platform=facebook',
  };
  assert.throws(
    () => buildSharedTableViewInstallerContract({
      schema,
      views: [{ ...accountDailyView, filter: 'platform!=facebook' }],
    }),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );
  assert.throws(
    () => buildSharedTableViewInstallerContract({
      schema,
      views: [{ ...accountDailyView, filter: 'missing_field=facebook' }],
    }),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );
});

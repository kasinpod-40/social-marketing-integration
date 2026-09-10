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
  selectMktAdsCampaignSummaryLarkContract,
  validateMktAdsCampaignSummaryLarkSchema,
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

test('derives the three customer-facing shared tables from the approved CSV contract', async () => {
  const { schema, views } = await loadContract();
  assert.equal(validateSharedTableLarkSchema(schema), true);
  assert.equal(schema.length, SHARED_TABLE_LARK_SCHEMA_EXPECTED_TABLE_COUNT);
  assert.equal(schema.flatMap((table) => table.fields).length, SHARED_TABLE_LARK_SCHEMA_EXPECTED_FIELD_COUNT);
  assert.equal(SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS.length, 3);
  assert.ok(SHARED_TABLE_LARK_SCHEMA_TABLE_KEYS.every((key) => typeof LARK_TABLE_ENV[key] === 'string'));
  assert.equal(schema.filter((table) => table.sharedTable.physicalAction === 'rename_reuse_in_place').length, 0);
  assert.equal(schema.filter((table) => table.sharedTable.physicalAction === 'create_new').length, 3);
  assert.equal(views.length, 4);
});

test('does not provision legacy RAW aliases in the customer-facing schema', async () => {
  const { schema } = await loadContract();
  const byName = new Map(schema.map((table) => [table.logicalName, table]));
  assert.equal(byName.has('RAW_Meta_Organic_Accounts'), false);
  assert.equal(byName.has('RAW_Ads_Daily'), false);
  assert.deepEqual(byName.get('MKT_Account_Daily').aliases, ['MKT_Account_Daily']);
  assert.equal(byName.get('MKT_Ads_Ads').sharedTable.preserveTableId, false);
  assert.deepEqual(byName.get('MKT_Ads_Campaign_Summary').aliases, [
    'MKT_Ads_Campaign_Summary', '📊 MKT_Ads_Campaign_Summary',
  ]);
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
  const summary = byName.get('MKT_Ads_Campaign_Summary');
  assert.equal(summary.get('campaign_summary_key').primary, true);
  assert.equal(summary.get('period_month_th').required, true);
  assert.match(summary.get('period_month_th').description, /เดือนภาษาไทย/u);
  assert.ok([...summary.values()].every((field) => /[ก-๙]/u.test(field.description)));
  assert.deepEqual(summary.get('platform').property.options.map((option) => option.name), [
    'meta_ads', 'google_ads', 'tiktok_ads',
  ]);
  assert.equal(summary.get('period_start').property.date_formatter, 'yyyy/MM/dd');
  assert.equal(summary.get('last_synced_at').property.date_formatter, 'yyyy/MM/dd HH:mm');
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


test('installs only the four Campaign Summary Views with canonical filters', async () => {
  const { schema, views } = await loadContract();
  const contract = buildSharedTableViewInstallerContract({ schema, views });
  assert.equal(contract.length, 1);
  assert.deepEqual(contract[0].views.map((view) => view.name), [
    '📊 Overview', '🔵 Meta', '🔴 Google', '⚫ TikTok',
  ]);
  assert.deepEqual(contract[0].views.map((view) => view.filterInfo.conditions[0]), [
    { fieldName: 'platform', operator: 'isNotEmpty', value: null },
    { fieldName: 'platform', operator: 'is', value: 'meta_ads' },
    { fieldName: 'platform', operator: 'is', value: 'google_ads' },
    { fieldName: 'platform', operator: 'is', value: 'tiktok_ads' },
  ]);
});

test('selects a one-table Campaign Summary contract for a scoped PROD apply', async () => {
  const full = await loadContract();
  const selected = selectMktAdsCampaignSummaryLarkContract(full);
  assert.equal(validateMktAdsCampaignSummaryLarkSchema(selected.schema), true);
  assert.equal(selected.schema.length, 1);
  assert.equal(selected.views.length, 4);
  const installer = buildSharedTableViewInstallerContract({
    ...selected,
    validateSchema: validateMktAdsCampaignSummaryLarkSchema,
  });
  assert.equal(installer.length, 1);
});

test('rejects any Campaign Summary field or View drift from the exact runtime contract', async () => {
  const full = await loadContract();
  const selected = selectMktAdsCampaignSummaryLarkContract(full);
  const changedSchema = structuredClone(selected.schema);
  changedSchema[0].fields[0].fieldName = 'wrong_primary_key';
  assert.throws(
    () => validateMktAdsCampaignSummaryLarkSchema(changedSchema),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );

  const changedDateFormat = structuredClone(selected.schema);
  changedDateFormat[0].fields.find((field) => field.fieldName === 'period_start').property.date_formatter =
    'yyyy-MM-dd';
  assert.throws(
    () => validateMktAdsCampaignSummaryLarkSchema(changedDateFormat),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );

  const changedViews = structuredClone(selected.views);
  changedViews[1].filter = 'platform=facebook';
  assert.throws(
    () => selectMktAdsCampaignSummaryLarkContract({ schema: selected.schema, views: changedViews }),
    (error) => error?.code === 'SHARED_TABLE_LARK_SCHEMA_INVALID',
  );
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  META_LARK_SCHEMA_EXPECTED_FIELD_COUNT,
  META_LARK_SCHEMA_EXPECTED_TABLE_COUNT,
  META_LARK_SCHEMA_TABLE_KEYS,
  META_LARK_SCHEMA_VERSION,
  buildMetaLarkSchemaFromCsv,
  validateMetaLarkSchema,
} from '../../packages/config/src/meta-lark-schema.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { applyLarkSchema, planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';
import { assertMetaSchemaDevTarget } from '../../packages/config/src/meta-schema-runtime-config.js';

const ROOT = new URL('../../', import.meta.url);
const FIELD_FILES = Object.freeze([
  'docs/meta-blueprint-v0.12.0/facebook-organic-fields.csv',
  'docs/meta-blueprint-v0.12.0/instagram-organic-fields.csv',
  'docs/meta-blueprint-v0.12.0/meta-ads-fields.csv',
  'docs/meta-blueprint-v0.12.0/canonical-account-daily-fields.csv',
]);

async function loadSchema() {
  const [inventoryCsv, ...fieldCsvs] = await Promise.all([
    readFile(new URL('docs/meta-blueprint-v0.12.0/table-inventory.csv', ROOT), 'utf8'),
    ...FIELD_FILES.map((path) => readFile(new URL(path, ROOT), 'utf8')),
  ]);
  return buildMetaLarkSchemaFromCsv({ inventoryCsv, fieldCsvs });
}

test('derives the approved 15-table Meta DEV schema directly from source-controlled CSVs', async () => {
  const schema = await loadSchema();
  assert.equal(validateMetaLarkSchema(schema), true);
  assert.equal(schema.length, META_LARK_SCHEMA_EXPECTED_TABLE_COUNT);
  assert.equal(schema.flatMap((table) => table.fields).length, META_LARK_SCHEMA_EXPECTED_FIELD_COUNT);
  assert.equal(META_LARK_SCHEMA_TABLE_KEYS.length, META_LARK_SCHEMA_EXPECTED_TABLE_COUNT);
  assert.ok(META_LARK_SCHEMA_TABLE_KEYS.every((key) => typeof LARK_TABLE_ENV[key] === 'string'));
  assert.deepEqual(schema.map((table) => table.logicalName), [
    'RAW_Facebook_Pages', 'RAW_Facebook_Posts', 'RAW_Facebook_Post_Insights',
    'RAW_Facebook_Page_Insights', 'RAW_Instagram_Accounts', 'RAW_Instagram_Media',
    'RAW_Instagram_Media_Insights', 'RAW_Instagram_Account_Insights',
    'RAW_Meta_Ad_Accounts', 'RAW_Meta_Campaigns', 'RAW_Meta_Ad_Sets',
    'RAW_Meta_Ads', 'RAW_Meta_Creatives', 'RAW_Meta_Ads_Insights', 'MKT_Account_Daily',
  ]);
  assert.ok(schema.every((table) => table.fields[0].primary === true));
  assert.ok(schema.every((table) => table.fields.filter((field) => field.primary).length === 1));
  assert.ok(schema.every((table) => table.sourceContract.environments.includes('DEV')));
});

test('preserves approved field types, select options, date semantics and relation metadata', async () => {
  const schema = await loadSchema();
  const byName = new Map(schema.map((table) => [table.logicalName, table]));
  const posts = new Map(byName.get('RAW_Facebook_Posts').fields.map((field) => [field.fieldName, field]));
  assert.equal(posts.get('message').type, 1);
  assert.equal(posts.get('permalink_url').type, 15);
  assert.equal(posts.get('is_published').type, 7);
  assert.deepEqual(posts.get('post_type').property.options.map((option) => option.name), ['photo', 'video', 'status', 'link', 'reel', 'other']);
  assert.equal(posts.get('created_time').property.date_formatter, 'yyyy/MM/dd HH:mm');
  assert.equal(posts.get('source_page_id').relationTarget, 'RAW_Facebook_Pages');
  const daily = new Map(byName.get('MKT_Account_Daily').fields.map((field) => [field.fieldName, field]));
  assert.equal(daily.get('metric_date').property.date_formatter, 'yyyy/MM/dd');
  assert.deepEqual(daily.get('platform').property.options.map((option) => option.name), ['facebook', 'instagram']);
  assert.equal(daily.get('account_key').relationTarget, 'MKT_Accounts');
});

test('produces a conflict-free read-only creation plan without calling write methods', async () => {
  const schema = await loadSchema();
  const client = {
    async listTables() { return []; },
    async listFields() { throw new Error('not expected'); },
    async createTable() { throw new Error('not expected'); },
    async createField() { throw new Error('not expected'); },
    async updateField() { throw new Error('not expected'); },
  };
  const preview = await planLarkSchema({ client, env: {}, schema, schemaVersion: META_LARK_SCHEMA_VERSION, validateSchema: validateMetaLarkSchema });
  assert.equal(preview.readyToApply, true);
  assert.equal(preview.summary.createTables, 15);
  assert.equal(preview.actions.reduce((total, action) => total + action.fields.length, 0), 229);
});

test('applies the Meta schema once and a second plan is idempotently clean', async () => {
  const schema = await loadSchema();
  const client = createInMemorySchemaClient();
  const result = await applyLarkSchema({ client, env: {}, schema, schemaVersion: META_LARK_SCHEMA_VERSION, validateSchema: validateMetaLarkSchema });
  assert.equal(result.ok, true);
  assert.equal(result.summary.createdTables, 15);
  assert.equal(result.summary.createdFields, 0);
  assert.equal(result.verification.actions.length, 0);
  assert.equal(Object.keys(result.environmentUpdates).length, 15);
  const second = await planLarkSchema({ client, env: result.environmentUpdates, schema, schemaVersion: META_LARK_SCHEMA_VERSION, validateSchema: validateMetaLarkSchema });
  assert.equal(second.readyToApply, true);
  assert.equal(second.actions.length, 0);
  assert.equal(second.conflicts.length, 0);
});

test('restricts the current Meta schema task to the exact developer DEV target', () => {
  const base = {
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false', MKT_CONNECTOR_FACEBOOK_ENABLED: 'false',
    MKT_CONNECTOR_INSTAGRAM_ENABLED: 'false', MKT_CONNECTOR_YOUTUBE_ENABLED: 'false',
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'false', MKT_CONNECTOR_CHATWOOT_ENABLED: 'false',
  };
  const runtime = assertMetaSchemaDevTarget({ ...base, MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin' });
  assert.equal(runtime.profileKey, 'dev_ft_pumkin');
  assert.throws(() => assertMetaSchemaDevTarget({ ...base, MKT_ENV: 'uat', MKT_CUSTOMER_PROFILE: 'uat_chemistry_k' }), (error) => error?.code === 'META_SCHEMA_DEV_TARGET_REQUIRED');
});

test('safe environment examples declare every Meta schema table without live identifiers', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile(new URL('.dev.vars.example', ROOT), 'utf8'),
    readFile(new URL('wrangler.sync.example.jsonc', ROOT), 'utf8'),
  ]);
  for (const tableKey of META_LARK_SCHEMA_TABLE_KEYS) {
    const envName = LARK_TABLE_ENV[tableKey];
    assert.match(devVars, new RegExp(`^${envName}=replace-with-table-id$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${envName}"\\s*:\\s*"replace-with-table-id"`, 'u'));
  }
  assert.doesNotMatch(devVars, /FACEBOOK_PAGE_ID|INSTAGRAM_USER_ID|META_AD_ACCOUNT_ID/u);
  assert.doesNotMatch(wrangler, /FACEBOOK_PAGE_ID|INSTAGRAM_USER_ID|META_AD_ACCOUNT_ID/u);
});

test('fails closed when a table is not authorized for DEV schema application', async () => {
  const [inventoryCsv, ...fieldCsvs] = await Promise.all([
    readFile(new URL('docs/meta-blueprint-v0.12.0/table-inventory.csv', ROOT), 'utf8'),
    ...FIELD_FILES.map((path) => readFile(new URL(path, ROOT), 'utf8')),
  ]);
  const uatOnly = inventoryCsv.replace(
    'RAW_Meta_Ads_Insights,Raw,Meta Ads,Entity×Date×Placement,Upsert,raw_meta_ads_insight_key,Required,DEV/UAT,',
    'RAW_Meta_Ads_Insights,Raw,Meta Ads,Entity×Date×Placement,Upsert,raw_meta_ads_insight_key,Required,UAT,',
  );
  assert.throws(() => buildMetaLarkSchemaFromCsv({ inventoryCsv: uatOnly, fieldCsvs }), (error) => error?.code === 'META_LARK_SCHEMA_INVALID' && /not approved for DEV/u.test(error.message));
});

test('fails closed when the approved CSV contract is incomplete', async () => {
  const [inventoryCsv, ...fieldCsvs] = await Promise.all([
    readFile(new URL('docs/meta-blueprint-v0.12.0/table-inventory.csv', ROOT), 'utf8'),
    ...FIELD_FILES.map((path) => readFile(new URL(path, ROOT), 'utf8')),
  ]);
  const broken = fieldCsvs.map((csv, index) => index === 0 ? csv.replace(/^RAW_Facebook_Pages,1,.*\n/mu, '') : csv);
  assert.throws(() => buildMetaLarkSchemaFromCsv({ inventoryCsv, fieldCsvs: broken }), (error) => error?.code === 'META_LARK_SCHEMA_INVALID');
});

function createInMemorySchemaClient() {
  let nextTable = 1;
  let nextField = 1;
  const tables = [];
  const fieldsByTable = new Map();
  return {
    async listTables() { return tables.map((table) => ({ ...table })); },
    async listFields({ tableId }) { return (fieldsByTable.get(tableId) ?? []).map((field) => structuredClone(field)); },
    async createTable({ name, fields }) {
      const tableId = `tbl_meta_${nextTable++}`;
      tables.push({ tableId, name });
      fieldsByTable.set(tableId, fields.map((field, index) => ({ fieldId: `fld_meta_${nextField++}`, fieldName: field.fieldName, type: field.type, isPrimary: index === 0, property: field.property ? structuredClone(field.property) : null, description: field.description ?? null })));
      return { tableId, name };
    },
    async createField({ tableId, field }) {
      const created = { fieldId: `fld_meta_${nextField++}`, fieldName: field.fieldName, type: field.type, isPrimary: false, property: field.property ? structuredClone(field.property) : null, description: field.description ?? null };
      fieldsByTable.get(tableId).push(created);
      return structuredClone(created);
    },
    async updateField({ tableId, fieldId, field }) {
      const fields = fieldsByTable.get(tableId);
      const index = fields.findIndex((candidate) => candidate.fieldId === fieldId);
      fields[index] = { ...fields[index], fieldName: field.fieldName, type: field.type, property: field.property ? structuredClone(field.property) : null, description: field.description ?? null };
      return structuredClone(fields[index]);
    },
  };
}

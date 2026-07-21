import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseCsvRecords } from '../../packages/shared/src/text/csv.js';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { PROTECTED_LARK_TABLES } from '../../packages/config/src/lark-table-governance.js';

const ROOT = new URL('../../', import.meta.url);
const DIR = 'docs/shared-table-blueprint-v0.12.1/';

async function csv(name) {
  return parseCsvRecords(await readFile(new URL(`${DIR}${name}`, ROOT), 'utf8'));
}

test('shared-table revision adds only two justified tables and reuses five empty planned slots', async () => {
  const [inventory, migration, current] = await Promise.all([
    csv('table-inventory.csv'), csv('migration-map.csv'), csv('current-base-inventory.csv'),
  ]);
  assert.equal(inventory.length, 7);
  assert.deepEqual(inventory.filter((row) => row['Physical action'] === 'Create new').map((row) => row.Table), [
    'MKT_Account_Daily', 'MKT_Ads_Ads',
  ]);
  assert.equal(inventory.filter((row) => row['Physical action'] === 'Rename/reuse in place').length, 5);
  assert.equal(migration.filter((row) => row.Action === 'Rename/reuse empty slot').length, 5);
  assert.equal(current.length, 26);
  assert.equal(current.reduce((total, row) => total + Number(row.Records), 0), 4641);
  assert.equal(current.reduce((total, row) => total + Number(row.Fields), 0), 352);
  assert.equal(current.reduce((total, row) => total + Number(row.Views), 0), 81);
  const reuseSources = new Set(migration.filter((row) => row.Action === 'Rename/reuse empty slot').map((row) => row['Current table']));
  for (const row of current.filter((entry) => reuseSources.has(entry.Table))) assert.equal(row.Records, '0');
});

test('locks shared tables and environment mappings without platform-specific raw table growth', async () => {
  const inventory = await csv('table-inventory.csv');
  const names = inventory.map((row) => row.Table);
  assert.deepEqual(names.slice(0, 5), [
    'RAW_Meta_Organic_Accounts', 'RAW_Meta_Organic_Content', 'RAW_Meta_Organic_Metrics',
    'RAW_Ads_Entities', 'RAW_Ads_Daily',
  ]);
  assert.equal(names.some((name) => /^RAW_(Facebook|Instagram|Meta_Campaign|Meta_Ad_Sets|Meta_Ads|Meta_Creatives)/u.test(name)), false);
  assert.equal(LARK_TABLE_ENV.rawMetaOrganicAccounts, 'LARK_TABLE_RAW_META_ORGANIC_ACCOUNTS');
  assert.equal(LARK_TABLE_ENV.rawMetaOrganicContent, 'LARK_TABLE_RAW_META_ORGANIC_CONTENT');
  assert.equal(LARK_TABLE_ENV.rawMetaOrganicMetrics, 'LARK_TABLE_RAW_META_ORGANIC_METRICS');
  assert.equal(LARK_TABLE_ENV.rawAdsEntities, 'LARK_TABLE_RAW_ADS_ENTITIES');
  assert.equal(LARK_TABLE_ENV.rawAdsDaily, 'LARK_TABLE_RAW_ADS_DAILY');
  assert.equal(LARK_TABLE_ENV.mktAccountDaily, 'LARK_TABLE_MKT_ACCOUNT_DAILY');
  assert.equal('rawTikTokBusinessCampaigns' in LARK_TABLE_ENV, false);
  assert.equal('rawGoogleCampaigns' in LARK_TABLE_ENV, false);
});

test('field contract separates platform by views and preserves distinct grains', async () => {
  const [fields, views] = await Promise.all([csv('fields.csv'), csv('view-plan.csv')]);
  const byTable = Map.groupBy(fields, (row) => row.Table);
  assert.deepEqual([...byTable.keys()], [
    'RAW_Meta_Organic_Accounts', 'RAW_Meta_Organic_Content', 'RAW_Meta_Organic_Metrics',
    'RAW_Ads_Entities', 'RAW_Ads_Daily', 'MKT_Account_Daily', 'MKT_Ads_Ads',
  ]);
  for (const [table, rows] of byTable) {
    assert.equal(rows[0].Order, '1', `${table} first field`);
    assert.match(rows[0]['Key role'], /Primary/u, `${table} primary`);
    assert.equal(rows[0]['Lark Type'], 'Text');
    assert.deepEqual(rows.map((row) => Number(row.Order)), Array.from({ length: rows.length }, (_, index) => index + 1));
  }
  assert.ok(views.some((row) => row.Table === 'RAW_Meta_Organic_Content' && row.Filter === 'platform=facebook'));
  assert.ok(views.some((row) => row.Table === 'RAW_Ads_Entities' && row.Filter === 'platform=google_ads AND entity_type=campaign'));
  assert.ok(byTable.get('MKT_Account_Daily').some((row) => row.Field === 'metric_date'));
  assert.ok(byTable.get('MKT_Ads_Ads').some((row) => row.Field === 'external_creative_id'));
});

test('protected table contract exactly matches repository governance', async () => {
  const protectedRows = await csv('protected-tables.csv');
  assert.deepEqual(protectedRows.map((row) => row.Table), PROTECTED_LARK_TABLES.map((table) => table.logicalName));
  assert.match(protectedRows[0]['Blocked operations'], /create\/update\/delete fields/u);
});

test('safe examples expose only new shared logical mappings and protected source mapping', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile(new URL('.dev.vars.example', ROOT), 'utf8'),
    readFile(new URL('wrangler.sync.example.jsonc', ROOT), 'utf8'),
  ]);
  for (const key of ['rawTikTokCreatorVideos', 'rawMetaOrganicAccounts', 'rawMetaOrganicContent', 'rawMetaOrganicMetrics', 'rawAdsEntities', 'rawAdsDaily', 'mktAccountDaily']) {
    const envName = LARK_TABLE_ENV[key];
    assert.match(devVars, new RegExp(`^${envName}=replace-with-table-id$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${envName}"\s*:\s*"replace-with-table-id"`, 'u'));
  }
  for (const stale of ['LARK_TABLE_RAW_FACEBOOK_PAGES', 'LARK_TABLE_RAW_INSTAGRAM_MEDIA', 'LARK_TABLE_RAW_META_CAMPAIGNS']) {
    assert.doesNotMatch(devVars, new RegExp(stale, 'u'));
    assert.doesNotMatch(wrangler, new RegExp(stale, 'u'));
  }
});

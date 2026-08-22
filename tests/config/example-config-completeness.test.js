import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { STORAGE_FEATURE_FLAG_ENV } from '../../packages/config/src/storage-runtime-config.js';
import { YOUTUBE_REQUIRED_LARK_TABLE_KEYS } from '../../packages/config/src/youtube-organic-runtime-config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ACTIVE_RELEASE_LARK_TABLE_ENV = Object.freeze(
  Object.values(LARK_TABLE_ENV).filter(
    (envName) =>
      envName.startsWith('LARK_TABLE_MKT_') || envName === 'LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS',
  ),
);

test('safe examples declare every YouTube table required by activation preflight', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile(resolve(root, '.dev.vars.example'), 'utf8'),
    readFile(resolve(root, 'wrangler.sync.example.jsonc'), 'utf8'),
  ]);
  for (const tableKey of YOUTUBE_REQUIRED_LARK_TABLE_KEYS) {
    const envName = LARK_TABLE_ENV[tableKey];
    assert.match(devVars, new RegExp(`^${envName}=replace-with-table-id$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${envName}"\\s*:\\s*"replace-with-table-id"`, 'u'));
  }
});

test('safe examples declare every active release Lark table mapping', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile(resolve(root, '.dev.vars.example'), 'utf8'),
    readFile(resolve(root, 'wrangler.sync.example.jsonc'), 'utf8'),
  ]);

  for (const envName of ACTIVE_RELEASE_LARK_TABLE_ENV) {
    assert.match(devVars, new RegExp(`^${envName}=replace-with-table-id$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${envName}"\\s*:\\s*"replace-with-table-id"`, 'u'));
  }
});

test('release examples keep every connector, schedule and Storage flag fail-closed', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile(resolve(root, '.dev.vars.example'), 'utf8'),
    readFile(resolve(root, 'wrangler.sync.example.jsonc'), 'utf8'),
  ]);
  const flags = [
    'MKT_CONNECTOR_TIKTOK_ENABLED',
    'MKT_CONNECTOR_FACEBOOK_ENABLED',
    'MKT_CONNECTOR_INSTAGRAM_ENABLED',
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
    'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
    'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
    'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
    'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
    'MKT_CONNECTOR_YOUTUBE_ENABLED',
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_CONNECTOR_CHATWOOT_ENABLED',
    'MKT_SCHEDULE_TIKTOK_ENABLED',
    'MKT_SCHEDULE_YOUTUBE_ENABLED',
    'MKT_SCHEDULE_FACEBOOK_ENABLED',
    'MKT_SCHEDULE_INSTAGRAM_ENABLED',
    'MKT_SCHEDULE_META_ADS_ENABLED',
    'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
    'MKT_SCHEDULE_CHATWOOT_ENABLED',
    'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
    'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
    ...Object.values(STORAGE_FEATURE_FLAG_ENV),
  ];
  for (const flag of flags) {
    assert.match(devVars, new RegExp(`^${flag}=false$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${flag}"\\s*:\\s*"false"`, 'u'));
  }

  for (const content of [devVars, wrangler]) {
    assert.doesNotMatch(content, /dev_ft_pumkin|ft\.pumkin|uat_chemistry_k/u);
    assert.match(content, /MKT_CUSTOMER_PROFILE(?:=|"\s*:\s*")integration_workspace/u);
    assert.match(content, /TIKTOK_SOURCE_HANDLE(?:=|"\s*:\s*")chemistry_k/u);
  }
  assert.match(devVars, /^MKT_ENV=development$/mu);
  assert.match(wrangler, /"MKT_ENV"\s*:\s*"development"/u);
  assert.match(devVars, /^MKT_DAILY_REPORT_SETTING_KEY=integration_workspace:tiktok:daily$/mu);
  assert.match(wrangler, /"MKT_DAILY_REPORT_SETTING_KEY"\s*:\s*"integration_workspace:tiktok:daily"/u);
  assert.doesNotMatch(wrangler, /"META_(?:ACCESS_TOKEN|INSTAGRAM_ACCESS_TOKEN)"\s*:/u);
});

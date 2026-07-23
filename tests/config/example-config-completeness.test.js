import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LARK_TABLE_ENV } from '../../packages/config/src/lark-table-config.js';
import { YOUTUBE_REQUIRED_LARK_TABLE_KEYS } from '../../packages/config/src/youtube-organic-runtime-config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

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

test('release examples keep every connector and schedule fail-closed under Integration Workspace', async () => {
  const [devVars, wrangler] = await Promise.all([
    readFile(resolve(root, '.dev.vars.example'), 'utf8'),
    readFile(resolve(root, 'wrangler.sync.example.jsonc'), 'utf8'),
  ]);
  const flags = [
    'MKT_CONNECTOR_TIKTOK_ENABLED',
    'MKT_CONNECTOR_FACEBOOK_ENABLED',
    'MKT_CONNECTOR_INSTAGRAM_ENABLED',
    'MKT_CONNECTOR_YOUTUBE_ENABLED',
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_CONNECTOR_CHATWOOT_ENABLED',
    'MKT_SCHEDULE_TIKTOK_ENABLED',
    'MKT_SCHEDULE_YOUTUBE_ENABLED',
    'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
    'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
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
});

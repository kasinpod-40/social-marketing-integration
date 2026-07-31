import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const launcherUrl = new URL(
  '../../scripts/chatwoot-final-30d-daily-uat-launcher.mjs',
  import.meta.url,
);

test('final launcher verifies the exact Shared Reliability Chatwoot lock prefix before and after UAT', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /integration_workspace:chatwoot:chemistry_k:%/u);
  assert.match(source, /const before = readExactActiveLockCount\(env\)/u);
  assert.match(source, /const after = readExactActiveLockCount\(env\)/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_ACTIVE_LOCK_BLOCKED/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_POST_CLOSEOUT_LOCK_ACTIVE/u);
  assert.match(source, /expires_at > unixepoch\('now'\) \* 1000/u);
});

test('final launcher emits the authoritative success marker only after post-closeout lock verification', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  const afterIndex = source.indexOf('const after = readExactActiveLockCount(env)');
  const markerIndex = source.lastIndexOf('marker: CHATWOOT_FINAL_UAT_SUCCESS_MARKER');
  assert.ok(afterIndex >= 0);
  assert.ok(markerIndex > afterIndex);
  assert.match(source, /exactLockScopeVerified:\s*true/u);
  assert.match(source, /activeLockCount:\s*0/u);
});

test('launcher normalizes missing locked runtime vars without editing ignored local config', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /createNormalizedRuntimeConfig/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_LOCKED_VARS/u);
  assert.match(source, /SAFE_COMPATIBILITY_LIMITS/u);
  assert.match(source, /CHATWOOT_API_MAX_PAGES:\s*'1000'/u);
  assert.match(source, /CHATWOOT_MAX_REPORTING_EVENTS:\s*'100000'/u);
  assert.match(source, /Object\.assign\(config\.vars, SAFE_COMPATIBILITY_LIMITS\)/u);
  assert.match(source, /delete config\.vars\.CHATWOOT_INCREMENTAL_OVERLAP_HOURS/u);
  assert.match(source, /MKT_SCHEDULE_CHATWOOT_ENABLED/u);
  assert.match(source, /MKT_CHATWOOT_WEBHOOK_ENABLED/u);
  assert.match(source, /MKT_CHATWOOT_FINAL_UAT_WRANGLER_CONFIG:\s*normalizedConfigPath/u);
  assert.match(source, /rebaseGeneratedWranglerConfigPaths/u);
  assert.match(source, /await rm\(normalizedConfigPath/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_LOCAL_CONFIG_CONFLICT/u);
});

test('launcher delegates execution to the reviewed core and does not implement deployment or Queue submission', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /scripts\/chatwoot-final-30d-daily-uat\.mjs/u);
  assert.doesNotMatch(source, /wrangler[^\n]+deploy/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /api\.cloudflare\.com/u);
  assert.doesNotMatch(source, /MKT_CONNECTOR_CHATWOOT_ENABLED/u);
  assert.doesNotMatch(source, /MKT_CHATWOOT_D1_WRITE_ENABLED/u);
  assert.doesNotMatch(source, /MKT_CHATWOOT_LARK_WRITE_ENABLED/u);
  assert.doesNotMatch(source, /MKT_CHATWOOT_REPORT_WRITE_ENABLED/u);
});

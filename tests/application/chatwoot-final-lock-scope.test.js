import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

test('launcher pins exact D1 name and removes unsafe D1/Queue identity overrides', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /const DATABASE_NAME = 'social-mkt-state-dev'/u);
  assert.match(source, /UNSAFE_TARGET_OVERRIDES/u);
  assert.match(source, /MKT_CHATWOOT_FINAL_UAT_DATABASE_NAME/u);
  assert.match(source, /MKT_CHATWOOT_FINAL_UAT_QUEUE_ID/u);
  assert.match(source, /Object\.entries\(sourceEnv\)\.filter\(\(\[name\]\) => !UNSAFE_TARGET_OVERRIDES\.has\(name\)\)/u);
  assert.match(source, /'execute', DATABASE_NAME/u);
  assert.doesNotMatch(source, /env\.MKT_CHATWOOT_FINAL_UAT_DATABASE_NAME/u);
  assert.match(source, /exactQueueResolvedByName:\s*true/u);
});

test('launcher resolves the exact main Queue through the reviewed Cloudflare REST bootstrap', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  const installIndex = source.indexOf('await ensurePinnedWranglerInstalled()');
  const configIndex = source.indexOf('normalizedConfigPath = await createNormalizedRuntimeConfig(sourceEnv, larkMappings)');
  const bootstrapIndex = source.indexOf('const queueBootstrap = await bootstrapWooCommerceFinalQueueId({');
  const injectionIndex = source.indexOf('MKT_CHATWOOT_FINAL_UAT_QUEUE_ID: queueBootstrap.queueId');
  const lockIndex = source.indexOf('const before = readExactActiveLockCount(env)');

  assert.ok(installIndex >= 0);
  assert.ok(configIndex > installIndex);
  assert.ok(bootstrapIndex > configIndex);
  assert.ok(injectionIndex > bootstrapIndex);
  assert.ok(lockIndex > injectionIndex);
  assert.match(source, /const MAIN_QUEUE_NAME = 'social-mkt-sync-jobs'/u);
  assert.match(source, /const QUEUE_DISCOVERY_SOURCE = 'cloudflare_queue_rest'/u);
  assert.match(source, /delete queueBootstrapEnv\.MKT_WOOCOMMERCE_FINAL_QUEUE_ID/u);
  assert.match(source, /queueBootstrap\.source !== QUEUE_DISCOVERY_SOURCE/u);
  assert.match(source, /MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG:\s*normalizedConfigPath/u);
  assert.match(source, /queueDiscoverySource:\s*QUEUE_DISCOVERY_SOURCE/u);
  assert.match(source, /'node_modules',\s*'\.bin'/u);
  assert.match(source, /run\('npm', \['ci'\], \{ stdio: 'inherit' \}\)/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_PINNED_WRANGLER_MISSING/u);
  assert.doesNotMatch(source, /queues['"],\s*['"]list['"],\s*['"]--json/u);
  assert.doesNotMatch(source, /queueBootstrap\.queueId[^\n]*process\.stdout/u);
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

test('launcher discovers exact Chatwoot Lark tables before creating the private runtime config', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  const discoveryIndex = source.indexOf('const larkMappings = await resolveLarkTableMappings(sourceEnv)');
  const configIndex = source.indexOf('normalizedConfigPath = await createNormalizedRuntimeConfig(sourceEnv, larkMappings)');
  assert.ok(discoveryIndex >= 0);
  assert.ok(configIndex > discoveryIndex);
  assert.match(source, /createLarkBitableClientFromEnv/u);
  assert.match(source, /await client\.listTables\(\)/u);
  assert.match(source, /resolveChatwootFinalLarkAutoMappings/u);
  assert.match(source, /Object\.assign\(config\.vars, larkMappings\.values\)/u);
  assert.match(source, /larkTableMappingsResolved:\s*larkMappings\.tableCount/u);
  assert.doesNotMatch(source, /console\.log\([^\n]*tableId/u);
});

test('launcher normalizes missing locked runtime vars without editing ignored local config', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /createNormalizedRuntimeConfig/u);
  assert.match(source, /CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS/u);
  assert.match(source, /for \(const name of CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS\) config\.vars\[name\] = 'false'/u);
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

test('launcher delegates deployment and Queue submission to the reviewed core', async () => {
  const source = await readFile(launcherUrl, 'utf8');
  assert.match(source, /scripts\/chatwoot-final-30d-daily-uat\.mjs/u);
  assert.doesNotMatch(source, /wrangler[^\n]+deploy/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /api\.cloudflare\.com/u);
  assert.doesNotMatch(source, /config\.vars\[name\] = 'true'/u);
});

test('launcher plan executes without credentials or Remote action', () => {
  const result = spawnSync(process.execPath, [
    'scripts/chatwoot-final-30d-daily-uat-launcher.mjs',
  ], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    env: { ...process.env },
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"executed": false/u);
  assert.match(result.stdout, /"remoteActionsPerformed": false/u);
  assert.match(result.stdout, /"autoResolveChatwootLarkMappings": true/u);
  assert.match(result.stdout, /"queueDiscovery": "cloudflare_queue_rest"/u);
  assert.match(result.stdout, /chatwoot-final-30d-daily-uat-launcher\.mjs --execute/u);
  assert.doesNotMatch(result.stderr, /CHATWOOT_FINAL_UAT_/u);
});

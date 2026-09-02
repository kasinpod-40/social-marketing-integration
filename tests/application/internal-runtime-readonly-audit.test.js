import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const AUDIT = new URL('../../scripts/internal-runtime-readonly-audit.mjs', import.meta.url);

test('internal runtime audit plan is explicit about zero mutations and customer Base isolation', () => {
  const result = spawnSync(process.execPath, [AUDIT.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.mode, 'plan');
  assert.equal(payload.status, 'INTERNAL_RUNTIME_READONLY_AUDIT_PLAN');
  assert.equal(payload.targetDatabase, 'social-mkt-state-dev');
  assert.equal(payload.defaultConfig, 'wrangler.sync.jsonc');
  assert.equal(payload.providerReads, 0);
  assert.equal(payload.d1Writes, 0);
  assert.equal(payload.larkReads, 0);
  assert.equal(payload.larkWrites, 0);
  assert.equal(payload.queueSends, 0);
  assert.equal(payload.customerBaseReads, 0);
  assert.equal(payload.customerBaseWrites, 0);
});

test('internal runtime audit is pinned to internal DEV and does not read source payload units or call providers/Lark', async () => {
  const source = await readFile(AUDIT, 'utf8');

  assert.match(source, /const TARGET_DATABASE = 'social-mkt-state-dev'/u);
  assert.match(source, /const TARGET_BINDING = 'MKT_STATE_DB'/u);
  assert.match(source, /const DEFAULT_CONFIG = 'wrangler\.sync\.jsonc'/u);
  assert.match(source, /binding\.database_name !== TARGET_DATABASE/u);
  assert.match(source, /'wrangler', 'd1', 'execute', TARGET_DATABASE/u);
  assert.match(source, /--remote/u);
  assert.match(source, /assertReadOnlySql\(sql, name\)/u);
  assert.doesNotMatch(source, /sync_work_units/u);
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /LARK_APP_SECRET/u);
  assert.doesNotMatch(source, /chemistry_k/u);
  assert.doesNotMatch(source, /customer-youtube-uat/u);
});

test('internal runtime audit uses bounded operational and freshness queries', async () => {
  const source = await readFile(AUDIT, 'utf8');

  assert.match(source, /latestWorkByCursor/u);
  assert.match(source, /incompletePhases/u);
  assert.match(source, /activeLocks/u);
  assert.match(source, /dlqCounts/u);
  assert.match(source, /openAlerts/u);
  assert.match(source, /pendingWarnings/u);
  assert.match(source, /recentRuns/u);
  assert.match(source, /latestCoverage/u);
  assert.match(source, /latestReports/u);
  assert.match(source, /LIMIT \$\{MAX_WORK_ROWS\}/u);
  assert.match(source, /LIMIT \$\{MAX_RUN_ROWS\}/u);
  assert.match(source, /LIMIT \$\{MAX_COVERAGE_ROWS\}/u);
  assert.match(source, /LIMIT \$\{MAX_REPORT_ROWS\}/u);
});

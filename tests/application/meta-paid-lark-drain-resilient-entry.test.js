import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sourcePath = 'scripts/meta-paid-lark-drain-resilient-entry.mjs';

test('resilient entry resolves account-live D1 before any drain child is launched', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /'deployments', 'status', '--json', '--config'/u);
  assert.match(source, /'versions', 'view', versionId, '--json', '--config'/u);
  assert.match(source, /'d1', 'list', '--json', '--config'/u);
  assert.match(source, /parseActiveDeploymentVersionIds/u);
  assert.match(source, /resolveSharedActiveD1BindingId/u);
  assert.match(source, /resolveAccountD1Authority/u);
  assert.match(source, /activeBindingDatabaseId/u);
  assert.match(source, /activeBindingPresentInAccount/u);
  assert.match(source, /authoritySource/u);
  assert.match(source, /materializeActiveD1Config/u);
  assert.match(source, /MKT_META_D1_ONLY_WRANGLER_CONFIG:\s*temporaryConfigPath/u);
  assert.match(source, /await runSupervisedDrain\(runtime\.env\)/u);
  assert.match(source, /await diagnoseReadOnlyD1\(runtime\.env\)/u);
  assert.match(source, /await rm\(runtime\.temporaryRoot, \{ recursive: true, force: true \}\)/u);
});

test('resilient entry materializes authority in a private temp config and never writes the source config', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /mkdtemp\(join\(tmpdir\(\), 'meta-paid-lark-active-d1-'\)\)/u);
  assert.match(source, /writeFile\(temporaryConfigPath, materialized\.text, \{ mode: 0o600 \}\)/u);
  assert.match(source, /chmod\(temporaryConfigPath, 0o600\)/u);
  assert.doesNotMatch(source, /writeFile\(sourceConfigPath/u);
  assert.match(source, /sourceConfigModified:\s*false/u);
  assert.match(source, /activeD1MutationAllowed:\s*false/u);
  assert.match(source, /traffic_bearing_worker_versions_cross_checked_with_account_d1_inventory/u);
});

test('resilient entry retries only bounded pre-closeout read failures', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /const MAX_ATTEMPTS = 3/u);
  assert.match(source, /const READ_TIMEOUT_MS = 60_000/u);
  assert.match(source, /META_PAID_LARK_DRAIN_COMMAND_FAILED/u);
  assert.match(source, /if \(closeoutLaunched\)[\s\S]*automatic retry is blocked/u);
  assert.match(source, /META_PAID_LARK_DRAIN_RESILIENT_RETRY_EXHAUSTED/u);
});

test('resilient entry diagnoses exact read-only queries and surfaces sanitized command output', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /buildMetaPaidLarkRuntimeDiagnosisQueries/u);
  assert.match(source, /'wrangler', 'd1', 'execute', 'MKT_STATE_DB'/u);
  assert.match(source, /'--remote', '--json'/u);
  assert.match(source, /sanitizeCliOutput/u);
  assert.match(source, /errorMessage/u);
  assert.match(source, /stdout/u);
  assert.match(source, /stderr/u);
  assert.match(source, /failedQuery/u);
  assert.match(source, /timedOut/u);
});

test('resilient entry delegates to existing supervised drain and adds no direct mutation command', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /meta-paid-lark-drain-closeout-supervised\.mjs/u);
  assert.doesNotMatch(source, /wrangler['",\s]+deploy/iu);
  assert.doesNotMatch(source, /\.send\s*\(/u);
  assert.doesNotMatch(source, /['"`]\s*(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE)\b/iu);
  assert.match(source, /directRemoteMutationPerformed:\s*false/u);
});

test('resilient entry never retries once closeout evidence appears', async () => {
  const source = await readFile(sourcePath, 'utf8');
  assert.match(source, /launch_existing_closeout\|private-safe-config-materialized\|META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE/u);
  assert.match(source, /META_PAID_LARK_DRAIN_RESILIENT_CLOSEOUT_STARTED/u);
});

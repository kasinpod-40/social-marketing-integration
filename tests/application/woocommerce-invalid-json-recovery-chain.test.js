import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const OPERATION_ID = 'woo-final-full-5b56469100a9';

test('invalid-JSON recovery chain follows the proven ephemeral diagnostics recovery completion order', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-invalid-json-recovery-chain.mjs', import.meta.url),
    'utf8',
  );
  const diagnostics = source.indexOf("'woocommerce-worker-provider-diagnostics-ephemeral'");
  const recovery = source.indexOf("'woocommerce-final-recovery-only'");
  const completion = source.indexOf("'woocommerce-2026-completion-canonical'");

  assert.ok(diagnostics >= 0);
  assert.ok(recovery > diagnostics);
  assert.ok(completion > recovery);
  assert.match(source, new RegExp(OPERATION_ID, 'u'));
  assert.match(source, /RECOVER_WOO_FINAL_FULL_5B56469100A9_AND_COMPLETE/u);
  assert.match(source, /scripts\/woocommerce-worker-provider-diagnostics-ephemeral\.mjs/u);
  assert.doesNotMatch(
    source,
    /\['scripts\/woocommerce-worker-provider-diagnostics\.mjs', '--execute'\]/u,
  );
  assert.match(source, /WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION/u);
  assert.match(source, /WOOCOMMERCE_FINAL_RECOVERY_ONLY_CONFIRMATION/u);
  assert.match(source, /WOOCOMMERCE_2026_COMPLETION_CONFIRMATION/u);
});

test('supported ephemeral diagnostics entrypoint creates one-time auth material only for execute', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /randomBytes\(32\)\.toString\('base64url'\)/u);
  assert.match(source, /createHash\('sha256'\)\.update\(token\)\.digest\('hex'\)/u);
  assert.match(source, /MKT_CONNECTION_OPERATOR_TOKEN/u);
  assert.match(source, /MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256/u);
  assert.match(source, /await import\('\.\/woocommerce-worker-provider-diagnostics\.mjs'\)/u);
  assert.doesNotMatch(source, /console\.|writeFile|appendFile/u);
});

test('invalid-JSON recovery chain is resumable after exact lifecycle recovery', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-invalid-json-recovery-chain.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /active_recovery_required/u);
  assert.match(source, /terminal_recovery_complete/u);
  assert.match(source, /recoveryExecuted/u);
  assert.match(source, /classifyWooCommerceFinalRecoveryOnlyState/u);
  assert.match(source, /providerDiagnosticsPassed: true/u);
});

test('chain delegates guarded actions and contains no direct Business or Queue mutation', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-invalid-json-recovery-chain.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /\b(?:UPDATE|DELETE|INSERT|DROP|ALTER|CREATE)\s+(?:TABLE|FROM|INTO|sync_|raw_|commerce_)/iu);
  assert.doesNotMatch(source, /queues\/.+\/messages|MKT_SYNC_QUEUE|\.send\(/u);
  assert.doesNotMatch(source, /wrangler[^\n]*deploy/u);
  assert.match(source, /production: 'BLOCKED'/u);
  assert.match(source, /production: false/u);
});

test('ephemeral provider diagnostics must pass before lifecycle mutation is authorized', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-invalid-json-recovery-chain.mjs', import.meta.url),
    'utf8',
  );
  const diagnosticsCall = source.indexOf("'woocommerce-worker-provider-diagnostics-ephemeral'");
  const activeBranch = source.indexOf("classified.state === 'active_recovery_required'");
  const recoveryCall = source.indexOf("'woocommerce-final-recovery-only'");
  const postRead = source.indexOf('const after = readIncidentState');

  assert.ok(diagnosticsCall >= 0);
  assert.ok(activeBranch > diagnosticsCall);
  assert.ok(recoveryCall > activeBranch);
  assert.ok(postRead > recoveryCall);
});

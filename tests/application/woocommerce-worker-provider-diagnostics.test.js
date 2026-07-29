import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseJsoncObject } from '../../scripts/lib/chatwoot-safe-wrangler-config.js';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  buildWooCommerceWorkerProviderDiagnosticConfigs,
  parseWooCommerceWorkerSecretNames,
  validateWooCommerceWorkerProviderDiagnosticResponse,
} from '../../scripts/lib/woocommerce-worker-provider-diagnostics.js';

const CONFIG = JSON.stringify({
  name: 'social-mkt-sync-worker',
  main: 'apps/sync-worker/src/index.js',
  compatibility_date: '2026-07-01',
  version_metadata: { binding: 'CF_VERSION_METADATA' },
  vars: {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_CONNECTION_PUBLIC_ORIGIN: 'https://social-mkt-sync-worker.example.workers.dev',
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'true',
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: 'true',
    MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'true',
    MKT_TIKTOK_AUDIT_HTTP_ENABLED: 'true',
  },
}, null, 2);

test('builds one diagnostic-only Worker config and one all-false Safe config', () => {
  const result = buildWooCommerceWorkerProviderDiagnosticConfigs(CONFIG, {
    repositoryRoot: '/repo',
    sourceConfigPath: 'wrangler.sync.jsonc',
  });
  const safe = parseJsoncObject(result.safe);
  const active = parseJsoncObject(result.active);

  assert.deepEqual(result.safeTrueFlags, []);
  assert.deepEqual(result.activeTrueFlags, [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]);
  assert.equal(safe.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'false');
  assert.equal(active.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'true');
  assert.equal(active.vars.MKT_CONNECTOR_WOOCOMMERCE_ENABLED, 'false');
  assert.equal(active.vars.MKT_WOOCOMMERCE_D1_WRITE_ENABLED, 'false');
  assert.equal(active.vars.MKT_WOOCOMMERCE_LARK_WRITE_ENABLED, 'false');
  assert.equal(active.vars.MKT_SCHEDULE_WOOCOMMERCE_ENABLED, 'false');
  assert.equal(active.vars.MKT_TIKTOK_AUDIT_HTTP_ENABLED, 'false');
  assert.equal(active.vars.WOOCOMMERCE_BASE_URL, 'https://chemistryk.online');
  assert.equal(active.vars.WOOCOMMERCE_API_VERSION, 'wc/v3');
  assert.equal(active.vars.WOOCOMMERCE_API_TIMEOUT_MS, '45000');
  assert.equal(active.vars.WOOCOMMERCE_DEFAULT_CURRENCY, 'THB');
  assert.equal(result.origin, 'https://social-mkt-sync-worker.example.workers.dev');
  assert.equal(result.secretValuesCopied, 0);
  assert.equal(result.active.includes('ck_'), false);
  assert.equal(result.active.includes('cs_'), false);
});

test('requires all three existing Worker Secret names without reading their values', () => {
  const names = parseWooCommerceWorkerSecretNames(JSON.stringify([
    { name: 'WOOCOMMERCE_CONSUMER_SECRET' },
    { name: 'MKT_CONNECTION_OPERATOR_TOKEN' },
    { name: 'WOOCOMMERCE_CONSUMER_KEY' },
  ]));
  assert.deepEqual(names, [
    'MKT_CONNECTION_OPERATOR_TOKEN',
    'WOOCOMMERCE_CONSUMER_KEY',
    'WOOCOMMERCE_CONSUMER_SECRET',
  ]);
  assert.throws(
    () => parseWooCommerceWorkerSecretNames([{ name: 'WOOCOMMERCE_CONSUMER_KEY' }]),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_SECRET_MISSING',
  );
});

test('accepts only a bounded success or exact invalid-JSON diagnostic response', () => {
  const base = {
    stage: 'woocommerce-worker-provider-response-diagnostics',
    providerRequestCount: 1,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  };
  assert.equal(validateWooCommerceWorkerProviderDiagnosticResponse(200, {
    ...base,
    ok: true,
    store: { currency: 'THB' },
  }).ok, true);
  assert.equal(validateWooCommerceWorkerProviderDiagnosticResponse(422, {
    ...base,
    ok: false,
    code: 'WOOCOMMERCE_INVALID_JSON',
    failureDiagnostics: { resource: 'system_status' },
  }).code, 'WOOCOMMERCE_INVALID_JSON');
  assert.throws(
    () => validateWooCommerceWorkerProviderDiagnosticResponse(500, base),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_HTTP_INVALID',
  );
});

test('one-command operator has no Queue, D1, Lark, Schedule or Secret mutation command', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-worker-provider-diagnostics.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /workerDeploymentCount:\s*2/u);
  assert.match(source, /automatic-safe-restore/u);
  assert.match(source, /providerRequestCount:\s*1/u);
  assert.doesNotMatch(source, /queues?['"],\s*['"](?:send|messages)|d1['"],\s*['"](?:execute|migrations)|createLark|TableSyncEngine/u);
  assert.doesNotMatch(source, /secret['"],\s*['"](?:put|bulk|delete)/u);
});

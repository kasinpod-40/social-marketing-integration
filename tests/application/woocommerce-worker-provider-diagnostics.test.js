import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseJsoncObject } from '../../scripts/lib/chatwoot-safe-wrangler-config.js';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV,
  WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
  buildWooCommerceWorkerProviderDiagnosticConfigs,
  parseWooCommerceWorkerSecretNames,
  validateWooCommerceWorkerProviderDiagnosticResponse,
} from '../../scripts/lib/woocommerce-worker-provider-diagnostics.js';

const TOKEN_SHA256 = 'a'.repeat(64);
const CONFIG_OBJECT = {
  name: 'social-mkt-sync-worker',
  main: 'apps/sync-worker/src/index.js',
  compatibility_date: '2026-07-01',
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
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV]: 'b'.repeat(64),
  },
};
const CONFIG = JSON.stringify(CONFIG_OBJECT, null, 2);

function build(sourceText = CONFIG) {
  return buildWooCommerceWorkerProviderDiagnosticConfigs(sourceText, {
    repositoryRoot: '/repo',
    sourceConfigPath: 'wrangler.sync.jsonc',
    diagnosticTokenSha256: TOKEN_SHA256,
  });
}

test('builds one ephemeral-auth diagnostic config and one all-false Safe config', () => {
  const result = build();
  const safe = parseJsoncObject(result.safe);
  const active = parseJsoncObject(result.active);

  assert.deepEqual(result.safeTrueFlags, []);
  assert.deepEqual(result.activeTrueFlags, [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]);
  assert.equal(safe.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'false');
  assert.equal(safe.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV], undefined);
  assert.equal(active.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'true');
  assert.equal(active.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV], TOKEN_SHA256);
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
  assert.equal(result.ephemeralAuthDigestConfigured, true);
  assert.equal(result.secretValuesCopied, 0);
  assert.equal(result.active.includes('ck_'), false);
  assert.equal(result.active.includes('cs_'), false);
});

test('materializes exact Worker version metadata in both generated configs when source omits it', () => {
  const result = build();
  const safe = parseJsoncObject(result.safe);
  const active = parseJsoncObject(result.active);

  assert.equal(
    result.runtimeVersionMetadataBinding,
    WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
  );
  assert.deepEqual(safe.version_metadata, {
    binding: WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
  });
  assert.deepEqual(active.version_metadata, {
    binding: WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
  });
});

test('accepts the exact existing version metadata binding and rejects a conflicting binding', () => {
  const exact = build(JSON.stringify({
    ...CONFIG_OBJECT,
    version_metadata: {
      binding: WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
    },
  }));
  assert.equal(
    parseJsoncObject(exact.active).version_metadata.binding,
    WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
  );

  assert.throws(
    () => build(JSON.stringify({
      ...CONFIG_OBJECT,
      version_metadata: { binding: 'OTHER_VERSION_METADATA' },
    })),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_INVALID',
  );
});

test('requires only WooCommerce Worker Secret names without reading their values', () => {
  const names = parseWooCommerceWorkerSecretNames(JSON.stringify([
    { name: 'WOOCOMMERCE_CONSUMER_SECRET' },
    { name: 'WOOCOMMERCE_CONSUMER_KEY' },
  ]));
  assert.deepEqual(names, [
    'WOOCOMMERCE_CONSUMER_KEY',
    'WOOCOMMERCE_CONSUMER_SECRET',
  ]);
  assert.throws(
    () => parseWooCommerceWorkerSecretNames([{ name: 'WOOCOMMERCE_CONSUMER_KEY' }]),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_SECRET_MISSING',
  );
});

test('rejects a missing or malformed ephemeral authorization digest before deployment', () => {
  assert.throws(
    () => buildWooCommerceWorkerProviderDiagnosticConfigs(CONFIG, {
      repositoryRoot: '/repo',
      sourceConfigPath: 'wrangler.sync.jsonc',
      diagnosticTokenSha256: 'not-a-digest',
    }),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID',
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

test('ephemeral launcher generates auth without printing or mutating Worker Secrets', async () => {
  const [launcher, operator] = await Promise.all([
    readFile(
      new URL('../../scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../scripts/woocommerce-worker-provider-diagnostics.mjs', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(launcher, /randomBytes\(32\)/u);
  assert.match(launcher, /createHash\('sha256'\)/u);
  assert.match(launcher, /MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256/u);
  assert.doesNotMatch(launcher, /console\.|stdout\.write|stderr\.write/u);
  assert.match(operator, /workerDeploymentCount:\s*2/u);
  assert.match(operator, /automatic-safe-restore/u);
  assert.match(operator, /providerRequestCount:\s*1/u);
  assert.doesNotMatch(operator, /queues?['"],\s*['"](?:send|messages)|d1['"],\s*['"](?:execute|migrations)|createLark|TableSyncEngine/u);
  assert.doesNotMatch(`${launcher}\n${operator}`, /secret['"],\s*['"](?:put|bulk|delete)/u);
});

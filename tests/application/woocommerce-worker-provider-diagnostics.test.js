import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { parseJsoncObject } from '../../scripts/lib/chatwoot-safe-wrangler-config.js';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV,
  WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ENTRYPOINT,
  WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_METADATA_BINDING,
  buildWooCommerceWorkerProviderDiagnosticConfigs,
  parseWooCommerceWorkerSecretNames,
  validateWooCommerceDiagnosticsAttestation,
  validateWooCommerceWorkerProviderDiagnosticResponse,
} from '../../scripts/lib/woocommerce-worker-provider-diagnostics.js';

const TOKEN_SHA256 = 'a'.repeat(64);
const ACTIVE_ATTESTATION = 'c'.repeat(64);
const SAFE_ATTESTATION = 'd'.repeat(64);
const CONFIG_OBJECT = {
  name: 'social-mkt-sync-worker',
  main: 'apps/sync-worker/src/index.js',
  compatibility_date: '2026-07-01',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: false,
  routes: [{ pattern: 'sync.example.test', custom_domain: true }],
  triggers: { crons: ['*/5 * * * *'] },
  queues: {
    producers: [{ binding: 'MKT_SYNC_QUEUE', queue: 'social-mkt-sync-jobs' }],
  },
  d1_databases: [{
    binding: 'MKT_STATE_DB',
    database_name: 'fixture',
    database_id: '00000000-0000-0000-0000-000000000000',
  }],
  vars: {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_CONNECTION_PUBLIC_ORIGIN: 'https://wrong-public-origin.example',
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'true',
    MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'true',
    MKT_WOOCOMMERCE_LARK_WRITE_ENABLED: 'true',
    MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'true',
    MKT_TIKTOK_AUDIT_HTTP_ENABLED: 'true',
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV]: 'b'.repeat(64),
    [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV]: 'e'.repeat(64),
  },
};
const CONFIG = JSON.stringify(CONFIG_OBJECT, null, 2);

function build(sourceText = CONFIG, overrides = {}) {
  return buildWooCommerceWorkerProviderDiagnosticConfigs(sourceText, {
    repositoryRoot: '/repo',
    sourceConfigPath: 'wrangler.sync.jsonc',
    diagnosticTokenSha256: TOKEN_SHA256,
    activeAttestation: ACTIVE_ATTESTATION,
    safeAttestation: SAFE_ATTESTATION,
    ...overrides,
  });
}

test('builds isolated attested Active and all-false Safe Preview Version configs', () => {
  const result = build();
  const safe = parseJsoncObject(result.safe);
  const active = parseJsoncObject(result.active);
  const expectedMain = `/repo/${WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ENTRYPOINT}`;

  assert.deepEqual(result.safeTrueFlags, []);
  assert.deepEqual(result.activeTrueFlags, [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]);
  assert.equal(safe.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'false');
  assert.equal(safe.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV], undefined);
  assert.equal(safe.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV], SAFE_ATTESTATION);
  assert.equal(active.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG], 'true');
  assert.equal(active.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV], TOKEN_SHA256);
  assert.equal(active.vars[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV], ACTIVE_ATTESTATION);
  assert.equal(active.main, expectedMain);
  assert.equal(safe.main, expectedMain);
  assert.equal(active.workers_dev, false);
  assert.equal(active.preview_urls, true);
  assert.equal(result.workerName, 'social-mkt-sync-worker');
  assert.equal(result.previewUrlsEnabled, true);
  assert.equal(result.productionRoutesCopied, 0);
  assert.equal(result.productionBindingsCopied, 0);
  assert.equal(result.ephemeralAuthDigestConfigured, true);
  assert.equal(result.deploymentAttestationConfigured, true);
  assert.equal(result.secretValuesCopied, 0);
  assert.deepEqual(active.secrets.required, [
    'WOOCOMMERCE_CONSUMER_KEY',
    'WOOCOMMERCE_CONSUMER_SECRET',
  ]);
  for (const key of ['routes', 'route', 'triggers', 'queues', 'd1_databases']) {
    assert.equal(active[key], undefined);
    assert.equal(safe[key], undefined);
  }
  for (const name of [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
    'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
    'MKT_TIKTOK_AUDIT_HTTP_ENABLED',
  ]) {
    assert.equal(active.vars[name], 'false');
  }
  assert.equal(active.vars.WOOCOMMERCE_BASE_URL, 'https://chemistryk.online');
  assert.equal(active.vars.WOOCOMMERCE_API_VERSION, 'wc/v3');
  assert.equal(active.vars.WOOCOMMERCE_API_TIMEOUT_MS, '45000');
  assert.equal(active.vars.WOOCOMMERCE_DEFAULT_CURRENCY, 'THB');
  assert.equal(result.active.includes('ck_'), false);
  assert.equal(result.active.includes('cs_'), false);
});

test('materializes exact Worker version metadata in both Preview configs', () => {
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

test('accepts exact metadata binding and rejects conflicting binding', () => {
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

test('rejects missing, malformed or reused Preview attestations before upload', () => {
  assert.throws(
    () => build(CONFIG, { activeAttestation: 'not-a-digest' }),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID',
  );
  assert.throws(
    () => build(CONFIG, { safeAttestation: ACTIVE_ATTESTATION }),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_INVALID',
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

test('validates exact Preview attestation with bounded mismatch evidence', () => {
  const exact = new Response('{}', {
    status: 401,
    headers: { [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER]: ACTIVE_ATTESTATION },
  });
  assert.equal(validateWooCommerceDiagnosticsAttestation(exact, ACTIVE_ATTESTATION), ACTIVE_ATTESTATION);
  const missing = new Response('{}', {
    status: 404,
    headers: { 'content-type': 'text/html', server: 'cloudflare', 'cf-ray': 'fixture-ray' },
  });
  assert.throws(
    () => validateWooCommerceDiagnosticsAttestation(missing, ACTIVE_ATTESTATION),
    (error) => (
      error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ATTESTATION_MISMATCH'
      && error?.details?.observedAttestationPresent === false
      && error?.details?.responseStatus === 404
      && error?.details?.responseCfRayPresent === true
      && error?.details?.previewSafeCloseRequired === true
    ),
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

test('operator uploads isolated Preview Versions and never deploys Production', async () => {
  const [launcher, operator, entrypoint] = await Promise.all([
    readFile(
      new URL('../../scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../scripts/woocommerce-worker-provider-diagnostics.mjs', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../apps/sync-worker/src/woocommerce-provider-diagnostics-entry.js', import.meta.url),
      'utf8',
    ),
  ]);
  assert.match(launcher, /randomBytes\(32\)/u);
  assert.match(launcher, /createHash\('sha256'\)/u);
  assert.match(launcher, /MKT_WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256/u);
  assert.doesNotMatch(launcher, /console\.|stdout\.write|stderr\.write/u);
  assert.match(operator, /wrangler', 'versions', 'upload/u);
  assert.match(operator, /--preview-alias/u);
  assert.match(operator, /WRANGLER_OUTPUT_FILE_PATH/u);
  assert.match(operator, /productionDeploymentUnchanged/u);
  assert.match(operator, /workerDeploymentCount:\s*0/u);
  assert.match(operator, /workerVersionUploadCount/u);
  assert.doesNotMatch(operator, /wrangler', 'deploy'/u);
  assert.doesNotMatch(operator, /Cloudflare-Workers-Version-Overrides|buildWorkerVersionOverrideHeader/u);
  assert.doesNotMatch(operator, /queues?['"],\s*['"](?:send|messages)|d1['"],\s*['"](?:execute|migrations)|createLark|TableSyncEngine/u);
  assert.doesNotMatch(`${launcher}\n${operator}`, /secret['"],\s*['"](?:put|bulk|delete)/u);
  assert.match(entrypoint, /createWooCommerceProviderDiagnosticsHttpHandler/u);
  assert.doesNotMatch(entrypoint, /queue\s*\(|scheduled\s*\(|createCustomerConnectionHttpHandler|TableSyncEngine/u);
});

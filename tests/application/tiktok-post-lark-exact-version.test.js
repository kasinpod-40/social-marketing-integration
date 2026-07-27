import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER,
  TIKTOK_POST_LARK_RUNTIME_VERSION_HEADER,
  buildTikTokPostLarkVersionOverrideHeader,
  createTikTokPostLarkExactVersionFetch,
  fetchTikTokPostLarkExactVersionAudit,
  probeTikTokPostLarkExactVersionRouteStability,
  readTikTokPostLarkBoundedJsonResponse,
  validateTikTokPostLarkExactVersionEnableEvidence,
  validateTikTokPostLarkVersionMetadataConfig,
} from '../../scripts/lib/tiktok-post-lark-exact-version.js';
import { TIKTOK_POST_LARK_AUDIT_PATH } from '../../scripts/lib/tiktok-post-lark-rollout-operator.js';

const WORKER_NAME = 'social-mkt-sync-worker';
const VERSION_ID = '12345678-1234-4123-8123-123456789abc';
const OTHER_VERSION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function versionedResponse(status, body = '{}', versionId = VERSION_ID) {
  const headers = versionId == null
    ? {}
    : { [TIKTOK_POST_LARK_RUNTIME_VERSION_HEADER]: versionId };
  return new Response(body, { status, headers });
}

test('reviewed configs require the exact Version Metadata binding', () => {
  const valid = JSON.stringify({
    name: WORKER_NAME,
    version_metadata: { binding: 'CF_VERSION_METADATA' },
  }, null, 2);
  assert.deepEqual(validateTikTokPostLarkVersionMetadataConfig(valid), {
    versionMetadataBinding: 'CF_VERSION_METADATA',
  });
  for (const invalid of [
    JSON.stringify({ name: WORKER_NAME }),
    JSON.stringify({ version_metadata: { binding: 'OTHER_METADATA' } }),
  ]) {
    assert.throws(
      () => validateTikTokPostLarkVersionMetadataConfig(invalid),
      (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
    );
  }
});

test('version override uses the exact reviewed Worker name and deployment UUID', () => {
  assert.equal(
    buildTikTokPostLarkVersionOverrideHeader(WORKER_NAME, VERSION_ID),
    `${WORKER_NAME}="${VERSION_ID}"`,
  );
});

test('exact-version fetch pins the request and requires matching runtime attestation', async () => {
  const calls = [];
  const exactFetch = createTikTokPostLarkExactVersionFetch({
    workerName: WORKER_NAME,
    deploymentVersionId: VERSION_ID,
    async fetchImpl(input, init) {
      calls.push({ input: String(input), init });
      return versionedResponse(401);
    },
  });
  const response = await exactFetch('https://worker.example/operator', {
    method: 'GET',
    headers: { Pragma: 'no-cache' },
  });
  assert.equal(response.status, 401);
  assert.equal(calls.length, 1);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(
    headers.get(CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER),
    `${WORKER_NAME}="${VERSION_ID}"`,
  );
  assert.equal(headers.get('Pragma'), 'no-cache');
});

test('missing or mismatched runtime attestation fails closed with sanitized version evidence', async () => {
  for (const observed of [null, OTHER_VERSION_ID]) {
    const exactFetch = createTikTokPostLarkExactVersionFetch({
      workerName: WORKER_NAME,
      deploymentVersionId: VERSION_ID,
      fetchImpl: async () => versionedResponse(401, '{}', observed),
    });
    await assert.rejects(
      exactFetch('https://worker.example/operator'),
      (error) => {
        assert.equal(error.code, 'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_MISMATCH');
        assert.deepEqual(error.details, {
          expectedVersionId: VERSION_ID,
          observedVersionId: observed,
          safeCloseRequired: true,
        });
        assert.doesNotMatch(JSON.stringify(error.details), /worker\.example|authorization|token/iu);
        return true;
      },
    );
  }
});

test('exact-version route gate keeps three status probes on the same runtime version', async () => {
  const requests = [];
  const sleeps = [];
  const result = await probeTikTokPostLarkExactVersionRouteStability({
    origin: 'https://worker.example',
    pathname: TIKTOK_POST_LARK_AUDIT_PATH,
    workerName: WORKER_NAME,
    environment: 'development',
    deploymentVersionId: VERSION_ID,
    expectedStatus: 401,
    createNonce: () => 'fixed-nonce',
    now: (() => {
      let value = Date.parse('2026-07-27T10:00:00.000Z');
      return () => {
        const result = new Date(value);
        value += 10;
        return result;
      };
    })(),
    sleep: async (delay) => sleeps.push(delay),
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return versionedResponse(401, 'private-response-body');
    },
  });

  assert.equal(result.stableRouteStatus, 401);
  assert.equal(result.runtimeVersionId, VERSION_ID);
  assert.equal(result.versionOverridePinned, true);
  assert.deepEqual(result.probes.map((probe) => probe.status), [401, 401, 401]);
  assert.deepEqual(sleeps, [250, 250]);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    const headers = new Headers(request.init.headers);
    assert.equal(
      headers.get(CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER),
      `${WORKER_NAME}="${VERSION_ID}"`,
    );
    assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('Cache-Control'), 'no-cache, no-store');
    assert.equal(headers.get('Pragma'), 'no-cache');
    assert.equal(request.init.redirect, 'manual');
  }
  assert.doesNotMatch(
    JSON.stringify(result),
    /worker\.example|fixed-nonce|private-response-body|Cloudflare-Workers-Version-Overrides/iu,
  );
});

test('authenticated Audit is cache-busted, no-cache, redirect-blocked and version-pinned', async () => {
  const calls = [];
  const response = await fetchTikTokPostLarkExactVersionAudit({
    origin: 'https://worker.example',
    pathname: TIKTOK_POST_LARK_AUDIT_PATH,
    workerName: WORKER_NAME,
    deploymentVersionId: VERSION_ID,
    operatorToken: '0123456789abcdef0123456789abcdef',
    createNonce: () => 'audit-nonce',
    async fetchImpl(input, init) {
      calls.push({ input: String(input), init });
      return versionedResponse(200, JSON.stringify({ ok: true }));
    },
  });
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  const url = new URL(calls[0].input);
  const headers = new Headers(calls[0].init.headers);
  assert.equal(url.pathname, TIKTOK_POST_LARK_AUDIT_PATH);
  assert.equal(url.searchParams.get('mkt_audit'), 'audit-nonce');
  assert.equal(calls[0].init.redirect, 'manual');
  assert.equal(headers.get('Authorization'), 'Bearer 0123456789abcdef0123456789abcdef');
  assert.equal(headers.get('Accept'), 'application/json');
  assert.equal(headers.get('Cache-Control'), 'no-cache, no-store');
  assert.equal(headers.get('Pragma'), 'no-cache');
  assert.equal(
    headers.get(CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER),
    `${WORKER_NAME}="${VERSION_ID}"`,
  );
});

test('bounded Audit JSON reader accepts valid data and rejects oversized responses', async () => {
  assert.deepEqual(
    await readTikTokPostLarkBoundedJsonResponse(versionedResponse(200, '{"ok":true}'), 64),
    { ok: true },
  );
  await assert.rejects(
    readTikTokPostLarkBoundedJsonResponse(versionedResponse(200, '{"private":"payload"}'), 4),
    (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_TOO_LARGE',
  );
});

test('authenticated Audit rejects legacy enable evidence without exact-version proof', () => {
  const valid = {
    deploymentVersionId: VERSION_ID,
    runtimeVersionId: VERSION_ID,
    versionOverridePinned: true,
  };
  assert.equal(validateTikTokPostLarkExactVersionEnableEvidence(valid), valid);
  for (const invalid of [
    { ...valid, runtimeVersionId: OTHER_VERSION_ID },
    { ...valid, runtimeVersionId: null },
    { ...valid, versionOverridePinned: false },
  ]) {
    assert.throws(
      () => validateTikTokPostLarkExactVersionEnableEvidence(invalid),
      (error) => error.code === 'TIKTOK_POST_LARK_ROLLOUT_ENABLE_EVIDENCE_STALE',
    );
  }
});

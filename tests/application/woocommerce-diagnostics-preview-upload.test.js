import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildWooCommerceDiagnosticsPreviewOrigin,
  parseWooCommerceDiagnosticsPreviewUpload,
  parseWooCommerceDiagnosticsWranglerFailure,
  summarizeWooCommerceDiagnosticsWranglerEvidence,
} from '../../scripts/lib/woocommerce-diagnostics-preview-upload.js';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const INPUT = Object.freeze({
  previewAlias: 'woo-provider-diag-a1b2c3d4e5',
  workerName: 'social-mkt-sync-worker',
  accountWorkersDevSubdomain: 'account-preview-fixture',
});
const ORIGIN =
  'https://woo-provider-diag-a1b2c3d4e5-social-mkt-sync-worker.account-preview-fixture.workers.dev';
const VERSIONED_ORIGIN =
  'https://a1b2c3d4-social-mkt-sync-worker.account-preview-fixture.workers.dev';

function output(records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

function upload(overrides = {}) {
  return output([{
    type: 'version-upload',
    version_id: VERSION_ID,
    ...overrides,
  }]);
}

test('constructs the exact deterministic HTTPS Preview origin from validated labels', () => {
  assert.equal(buildWooCommerceDiagnosticsPreviewOrigin(INPUT), ORIGIN);
});

test('accepts exactly one structured upload when Wrangler emits no Preview URL', () => {
  const result = parseWooCommerceDiagnosticsPreviewUpload(upload(), 'bounded stdout', INPUT);
  assert.equal(result.versionId, VERSION_ID);
  assert.equal(result.previewOrigin, ORIGIN);
  assert.equal(result.wranglerPreviewUrlCrossCheckCount, 0);
  assert.equal(result.aliasedPreviewUrlCount, 0);
  assert.equal(result.versionedPreviewUrlCount, 0);
  assert.match(result.previewOriginFingerprint, /^[0-9a-f]{64}$/u);
});

test('accepts alias-only singular, array and nested declared Preview URL shapes', () => {
  for (const shape of [
    { preview_url: ORIGIN },
    { previewUrl: ORIGIN },
    { preview_urls: [ORIGIN] },
    { previewUrls: [ORIGIN] },
    { targets: [{ preview: { url: ORIGIN }, name: 'ignored-target-name' }] },
    { urls: { alias: ORIGIN } },
  ]) {
    const result = parseWooCommerceDiagnosticsPreviewUpload(upload(shape), '', INPUT);
    assert.equal(result.previewOrigin, ORIGIN);
    assert.equal(result.wranglerPreviewUrlCrossCheckCount, 1);
    assert.equal(result.aliasedPreviewUrlCount, 1);
    assert.equal(result.versionedPreviewUrlCount, 0);
  }
});

test('accepts versioned-only and alias-plus-versioned evidence while retaining alias authority', () => {
  for (const shape of [
    { preview_url: VERSIONED_ORIGIN },
    { targets: [{ url: ORIGIN }, { url: VERSIONED_ORIGIN }] },
    { urls: { aliased: { url: ORIGIN }, versioned: { url: VERSIONED_ORIGIN } } },
  ]) {
    const result = parseWooCommerceDiagnosticsPreviewUpload(upload(shape), '', INPUT);
    assert.equal(result.previewOrigin, ORIGIN);
    assert.equal(
      result.wranglerPreviewUrlCrossCheckCount,
      shape.preview_url ? 1 : 2,
    );
    assert.equal(result.aliasedPreviewUrlCount, shape.preview_url ? 0 : 1);
    assert.equal(result.versionedPreviewUrlCount, 1);
    assert.equal(result.distinctVersionedPreviewUrlCount, 1);
  }
});

test('accepts duplicate matching URL evidence without changing origin authority', () => {
  const result = parseWooCommerceDiagnosticsPreviewUpload(upload({
    preview_urls: [ORIGIN, ORIGIN, VERSIONED_ORIGIN, VERSIONED_ORIGIN],
  }), '', INPUT);
  assert.equal(result.previewOrigin, ORIGIN);
  assert.equal(result.wranglerPreviewUrlCrossCheckCount, 4);
  assert.equal(result.aliasedPreviewUrlCount, 2);
  assert.equal(result.versionedPreviewUrlCount, 2);
  assert.equal(result.distinctAliasedPreviewUrlCount, 1);
  assert.equal(result.distinctVersionedPreviewUrlCount, 1);
});

test('does not scan URL-looking values outside declared Preview containers', () => {
  const result = parseWooCommerceDiagnosticsPreviewUpload(upload({
    metadata: {
      preview_endpoint: 'https://foreign-worker.foreign-account.workers.dev',
    },
  }), '', INPUT);
  assert.equal(result.wranglerPreviewUrlCrossCheckCount, 0);
});

test('rejects missing and duplicate structured upload records', () => {
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload('', '', INPUT),
    (error) => (
      error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID'
      && error?.details?.versionUploadRecordCount === 0
    ),
  );
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(output([
      { type: 'version-upload', version_id: VERSION_ID },
      { type: 'version-upload', version_id: VERSION_ID },
    ]), '', INPUT),
    (error) => error?.details?.versionUploadRecordCount === 2,
  );
});

test('rejects malformed Worker version IDs', () => {
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(upload({
      version_id: 'not-a-version',
    }), '', INPUT),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID',
  );
});

test('accepts a distinct DNS-safe version prefix without changing deterministic target', () => {
  const observed = ORIGIN.replace('woo-provider-diag-a1b2c3d4e5', 'ffffffffff');
  const result = parseWooCommerceDiagnosticsPreviewUpload(upload({
    preview_url: observed,
  }), 'stdout fixture', INPUT);
  assert.equal(result.previewOrigin, ORIGIN);
  assert.equal(result.versionedPreviewUrlCount, 1);
  assert.equal(result.aliasedPreviewUrlCount, 0);
});

test('rejects a configured alias URL that is not the deterministic origin', () => {
  const observed = `${ORIGIN}/unexpected-path`;
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(upload({
      preview_url: observed,
    }), 'stdout fixture', INPUT),
    (error) => (
      error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID'
      && error?.details?.invalidCandidateSha256?.length === 64
      && !JSON.stringify(error).includes(ORIGIN)
      && !JSON.stringify(error).includes(observed)
    ),
  );
});

test('rejects more than one distinct versioned Preview origin', () => {
  const other = VERSIONED_ORIGIN.replace('a1b2c3d4', 'ffffeeee');
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(upload({
      targets: [ORIGIN, VERSIONED_ORIGIN, other],
    }), '', INPUT),
    (error) => (
      error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID'
      && error?.details?.distinctAliasedPreviewUrlCount === 1
      && error?.details?.distinctVersionedPreviewUrlCount === 2
    ),
  );
});

test('rejects malformed, foreign, custom-domain and structurally unsafe URL evidence', () => {
  for (const [fieldName, invalid] of [
    ['preview_url', ''],
    ['previewUrl', null],
    ['preview_urls', 42],
    ['preview_url', 'not-a-url'],
    ['preview_url', 'https://custom.example.test'],
    ['preview_url', ORIGIN.replace('https://', 'http://')],
    ['preview_url', ORIGIN.replace('social-mkt-sync-worker', 'foreign-worker')],
    ['preview_url', ORIGIN.replace('account-preview-fixture', 'foreign-account')],
    ['preview_url', `${ORIGIN}/unexpected-path`],
    ['preview_url', `${ORIGIN}?unexpected=true`],
    ['preview_url', `${ORIGIN}#unexpected`],
    ['preview_url', ORIGIN.replace('https://', 'https://user:password@')],
    ['preview_url', ORIGIN.replace('.workers.dev', '.workers.dev:8443')],
    ['preview_url', ORIGIN.replace('woo-provider-diag', 'Woo-provider-diag')],
  ]) {
    assert.throws(
      () => parseWooCommerceDiagnosticsPreviewUpload(upload({
        [fieldName]: invalid,
      }), '', INPUT),
      (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID',
    );
  }
});

test('rejects malformed URL values nested under declared URL fields', () => {
  for (const invalid of [
    'not-a-url',
    '',
    null,
  ]) {
    assert.throws(
      () => parseWooCommerceDiagnosticsPreviewUpload(upload({
        targets: [{ preview: { preview_url: invalid } }],
      }), '', INPUT),
      (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID',
    );
  }
});

test('rejects uppercase, unsafe and empty deterministic origin labels', () => {
  for (const [fieldName, value] of [
    ['previewAlias', 'Uppercase'],
    ['workerName', 'bad_worker'],
    ['accountWorkersDevSubdomain', ''],
  ]) {
    assert.throws(
      () => buildWooCommerceDiagnosticsPreviewOrigin({ ...INPUT, [fieldName]: value }),
      (error) => (
        error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ORIGIN_INVALID'
        && error?.details?.fieldName === fieldName
      ),
    );
  }
});

test('rejects a combined alias-worker label over the DNS limit', () => {
  assert.throws(
    () => buildWooCommerceDiagnosticsPreviewOrigin({
      ...INPUT,
      previewAlias: 'a'.repeat(40),
      workerName: 'b'.repeat(24),
    }),
    (error) => (
      error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_ORIGIN_INVALID'
      && error?.details?.labelLength === 65
      && error?.details?.maximumLabelLength === 63
    ),
  );
});

test('extracts one structured command-failed record with bounded redacted evidence', () => {
  const accountId = 'a'.repeat(32);
  const consumerKey = 'ck_fixture_should_not_escape';
  const result = parseWooCommerceDiagnosticsWranglerFailure(output([
    { type: 'wrangler-session', version: 1 },
    {
      type: 'command-failed',
      error: {
        code: 10021,
        message: `Request failed for account ${accountId}; URL https://api.cloudflare.com/test; key ${consumerKey}; file /Users/example/private/config.jsonc`,
      },
    },
  ]), 'stdout fixture', 'stderr fixture', 1);

  assert.equal(result.commandFailedRecordCount, 1);
  assert.equal(result.code, '10021');
  assert.equal(result.status, 1);
  assert.match(result.message, /\[REDACTED_ACCOUNT_ID\]/u);
  assert.match(result.message, /\[REDACTED_URL\]/u);
  assert.match(result.message, /ck_\[REDACTED\]/u);
  assert.match(result.message, /\[REDACTED_PATH\]/u);
  assert.equal(result.message.includes(accountId), false);
  assert.equal(result.message.includes(consumerKey), false);
  assert.equal(result.messageRedacted, true);
  assert.equal(result.rawOutputPersisted, false);
  assert.match(result.outputSha256, /^[0-9a-f]{64}$/u);
});

test('retains bounded sanitized fallback only in the low-level parser', () => {
  const result = parseWooCommerceDiagnosticsWranglerFailure(
    output([{ type: 'wrangler-session', version: 1 }]),
    '',
    '\u001B[31m✘ upload failed for admin@example.com using Bearer abcdefghijklmnopqrstuvwxyz0123456789\u001B[0m',
    1,
  );
  assert.equal(result.commandFailedRecordCount, 0);
  assert.equal(result.code, null);
  assert.equal(result.message.includes('\u001B'), false);
  assert.match(result.message, /\[REDACTED_EMAIL\]/u);
  assert.match(result.message, /Bearer \[REDACTED\]/u);
});

test('evidence summary counts captured files but reports only command-failed records', () => {
  const successfulUpload = upload({ preview_url: ORIGIN });
  const failed = output([{
    type: 'command-failed',
    error: { code: 11001, message: 'Queue handler is missing' },
  }]);
  const summary = summarizeWooCommerceDiagnosticsWranglerEvidence(
    [successfulUpload, failed],
    'application child failed after upload',
    1,
  );
  assert.equal(summary.capturedOutputFileCount, 2);
  assert.equal(summary.failures.length, 1);
  assert.equal(summary.failures[0].commandFailedRecordCount, 1);
  assert.equal(summary.failures[0].code, '11001');
});

test('application-level child failure never fabricates a Wrangler failure', () => {
  const summary = summarizeWooCommerceDiagnosticsWranglerEvidence(
    [upload()],
    '{"ok":false,"code":"APPLICATION_FAILURE"}',
    1,
  );
  assert.equal(summary.capturedOutputFileCount, 1);
  assert.deepEqual(summary.failures, []);
});

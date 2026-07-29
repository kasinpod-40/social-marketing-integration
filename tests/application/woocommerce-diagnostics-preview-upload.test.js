import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWooCommerceDiagnosticsPreviewUpload,
} from '../../scripts/lib/woocommerce-diagnostics-preview-upload.js';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const ALIAS = 'woo-provider-diag-a1b2c3d4e5';
const ALIAS_URL = `https://${ALIAS}-social-mkt-sync-worker.example.workers.dev`;
const COMMIT_URL = 'https://11111111-social-mkt-sync-worker.example.workers.dev';

function output(records) {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

test('parses exactly one structured version-upload and selects the alias Preview URL', () => {
  const result = parseWooCommerceDiagnosticsPreviewUpload(output([
    { type: 'wrangler-session', version: 1, command_line_args: ['versions', 'upload'] },
    {
      type: 'version-upload',
      version: 1,
      worker_name: 'social-mkt-sync-worker',
      version_id: VERSION_ID,
      preview_urls: [COMMIT_URL, ALIAS_URL],
    },
  ]), 'bounded stdout', ALIAS);

  assert.equal(result.versionId, VERSION_ID);
  assert.equal(result.previewOrigin, ALIAS_URL);
  assert.match(result.previewOriginFingerprint, /^[0-9a-f]{64}$/u);
});

test('accepts targets field and one unambiguous workers.dev Preview URL', () => {
  const result = parseWooCommerceDiagnosticsPreviewUpload(output([{
    type: 'version-upload',
    version_id: VERSION_ID,
    targets: [ALIAS_URL],
  }]), '', ALIAS);
  assert.equal(result.previewOrigin, ALIAS_URL);
});

test('rejects missing, duplicate or malformed version-upload records', () => {
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload('', '', ALIAS),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID',
  );
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(output([
      { type: 'version-upload', version_id: VERSION_ID, targets: [ALIAS_URL] },
      { type: 'version-upload', version_id: VERSION_ID, targets: [ALIAS_URL] },
    ]), '', ALIAS),
    (error) => error?.details?.versionUploadRecordCount === 2,
  );
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(output([{
      type: 'version-upload',
      version_id: 'not-a-version',
      targets: [ALIAS_URL],
    }]), '', ALIAS),
    (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_VERSION_UPLOAD_INVALID',
  );
});

test('rejects ambiguous, custom-domain and non-HTTPS targets with bounded evidence', () => {
  assert.throws(
    () => parseWooCommerceDiagnosticsPreviewUpload(output([{
      type: 'version-upload',
      version_id: VERSION_ID,
      targets: [
        'https://one-social-mkt-sync-worker.example.workers.dev',
        'https://two-social-mkt-sync-worker.example.workers.dev',
      ],
    }]), 'stdout fixture', ALIAS),
    (error) => (
      error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID'
      && error?.details?.previewUrlCount === 2
      && /^[0-9a-f]{64}$/u.test(error?.details?.stdoutSha256 ?? '')
    ),
  );
  for (const invalid of ['http://bad.example.workers.dev', 'https://custom.example.com']) {
    assert.throws(
      () => parseWooCommerceDiagnosticsPreviewUpload(output([{
        type: 'version-upload',
        version_id: VERSION_ID,
        targets: [invalid],
      }]), '', ALIAS),
      (error) => error?.code === 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_URL_INVALID',
    );
  }
});

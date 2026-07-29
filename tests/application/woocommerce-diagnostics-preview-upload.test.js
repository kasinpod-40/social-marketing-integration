import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWooCommerceDiagnosticsPreviewUpload,
  parseWooCommerceDiagnosticsWranglerFailure,
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
  assert.match(result.stdoutSha256, /^[0-9a-f]{64}$/u);
  assert.match(result.stderrSha256, /^[0-9a-f]{64}$/u);
});

test('falls back to sanitized stderr when structured command-failed is unavailable', () => {
  const result = parseWooCommerceDiagnosticsWranglerFailure(
    output([{ type: 'wrangler-session', version: 1 }]),
    '',
    '\u001B[31m✘ [ERROR] upload failed for admin@example.com using Bearer abcdefghijklmnopqrstuvwxyz0123456789\u001B[0m',
    1,
  );
  assert.equal(result.commandFailedRecordCount, 0);
  assert.equal(result.code, null);
  assert.equal(result.status, 1);
  assert.equal(result.message.includes('\u001B'), false);
  assert.match(result.message, /\[REDACTED_EMAIL\]/u);
  assert.match(result.message, /Bearer \[REDACTED\]/u);
});

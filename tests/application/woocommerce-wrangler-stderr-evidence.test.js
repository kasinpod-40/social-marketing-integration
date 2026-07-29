import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  extractWooCommerceWranglerStderrEvidence,
} from '../../scripts/lib/woocommerce-wrangler-stderr-evidence.js';

const ACCOUNT_ID = 'a'.repeat(32);
const UUID = '11111111-1111-4111-8111-111111111111';

test('retains nested validation detail while strictly redacting sensitive stderr values', () => {
  const result = extractWooCommerceWranglerStderrEvidence(`
\u001b[31mA request to the Cloudflare API (/accounts/${ACCOUNT_ID}/workers/scripts/social-mkt-sync-worker/versions) failed.\u001b[0m
validation failures: invalid alias: HEAD [code: 10021]
error authorization=Bearer abc.def.ghi
error consumer_secret=cs_super_secret_value
error local path /Users/example/private/${UUID}.json
noise that should not be returned
`);

  assert.equal(result.stderrEvidenceRedacted, true);
  assert.equal(result.rawStderrPersisted, false);
  assert.match(result.stderrSha256, /^[0-9a-f]{64}$/u);
  assert.ok(result.stderrEvidenceLines.some((line) => line.includes('invalid alias: HEAD')));
  assert.ok(result.stderrEvidenceLines.some((line) => line.includes('[REDACTED_ACCOUNT_ID]')));
  assert.ok(result.stderrEvidenceLines.some((line) => line.includes('authorization=[REDACTED]')));
  assert.ok(result.stderrEvidenceLines.some((line) => line.includes('consumer_secret=[REDACTED]')));
  assert.ok(result.stderrEvidenceLines.some((line) => line.includes('[REDACTED_PATH]')));
  assert.doesNotMatch(JSON.stringify(result), /abc\.def\.ghi|cs_super_secret_value|\/Users\/example|11111111-1111/u);
  assert.doesNotMatch(JSON.stringify(result), /noise that should not be returned/u);
});

test('bounds diagnostic evidence by line count, line length and total length', () => {
  const stderr = Array.from({ length: 30 }, (_unused, index) => (
    `validation error ${index}: ${'x'.repeat(800)}`
  )).join('\n');
  const result = extractWooCommerceWranglerStderrEvidence(stderr);
  assert.ok(result.stderrEvidenceLines.length <= 12);
  assert.ok(result.stderrEvidenceLines.every((line) => line.length <= 500));
  assert.ok(result.stderrEvidenceLines.join('').length <= 4_000);
});

test('preload targets only failed Wrangler version uploads and launcher delegates without persistence', async () => {
  const [preload, launcher] = await Promise.all([
    readFile(
      new URL('../../scripts/lib/woocommerce-wrangler-stderr-preload.mjs', import.meta.url),
      'utf8',
    ),
    readFile(
      new URL('../../scripts/woocommerce-worker-provider-diagnostics-stderr-evidence.mjs', import.meta.url),
      'utf8',
    ),
  ]);

  assert.match(preload, /executable === 'npx'/u);
  assert.match(preload, /args\[0\] === 'wrangler'/u);
  assert.match(preload, /args\[1\] === 'versions'/u);
  assert.match(preload, /args\[2\] === 'upload'/u);
  assert.match(preload, /syncBuiltinESMExports/u);
  assert.doesNotMatch(preload, /writeFile|appendFile|createWriteStream/u);
  assert.match(launcher, /CONFIRM_WOOCOMMERCE_WRANGLER_STDERR_EVIDENCE/u);
  assert.match(launcher, /CAPTURE_REDACTED_WRANGLER_STDERR_EVIDENCE/u);
  assert.match(launcher, /woocommerce-worker-provider-diagnostics-command-failed-evidence\.mjs/u);
  assert.match(launcher, /NODE_OPTIONS: `--import=\$\{preloadUrl\}`/u);
  assert.doesNotMatch(launcher, /wrangler['"],\s*['"](?:deploy|versions)/u);
});

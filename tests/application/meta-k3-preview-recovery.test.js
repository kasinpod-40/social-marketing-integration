import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  META_K3_PREVIEW_ENTRYPOINT,
  buildMetaK3PreviewRuntimeConfig,
  parseMetaK3PreviewUpload,
  validateMetaK3PreviewTransport,
} from '../../scripts/lib/meta-k3-preview-recovery.js';

const VERSION = '12345678-1234-4234-9234-123456789abc';
const BASELINE = '22345678-1234-4234-9234-123456789abc';

test('K3 Preview runtime pins the dedicated entrypoint and compiles from a nested config', () => {
  const root = mkdtempSync(join(tmpdir(), 'meta-k3-dedicated-preview-'));
  try {
    const entrypoint = join(root, META_K3_PREVIEW_ENTRYPOINT);
    const nestedConfig = join(root, 'outputs', 'incident', 'wrangler.jsonc');
    mkdirSync(join(entrypoint, '..'), { recursive: true });
    mkdirSync(join(nestedConfig, '..'), { recursive: true });
    writeFileSync(entrypoint, [
      'export default {',
      "  fetch() { return new Response('ok'); },",
      '  queue(batch) { batch.retryAll(); },',
      '};',
      '',
    ].join('\n'));

    const source = JSON.stringify({
      name: 'social-mkt-sync-worker',
      main: 'apps/sync-worker/src/index.js',
      compatibility_date: '2026-08-01',
      workers_dev: false,
      preview_urls: false,
      vars: {
        MKT_CONNECTOR_META_ADS_ENABLED: 'false',
        MKT_META_D1_WRITE_ENABLED: 'false',
      },
      routes: [{ pattern: 'example.com/*', zone_name: 'example.com' }],
      triggers: { crons: ['*/5 * * * *'] },
    }, null, 2);
    const built = buildMetaK3PreviewRuntimeConfig(source, {
      repositoryRoot: root,
    });
    assert.equal(built.previewEntrypoint, entrypoint);
    assert.equal(built.previewUrlsEnabled, true);
    assert.equal(built.workersDevEnabled, false);
    assert.equal(built.routesCopied, 0);
    assert.equal(built.scheduleTriggersCopied, 0);
    assert.deepEqual(built.trueFlags, []);
    assert.match(built.text, /meta-k3-exact-recovery-preview-entry\.js/u);
    assert.doesNotMatch(built.text, /example\.com/u);
    assert.doesNotMatch(built.text, /\*\/5 \* \* \* \*/u);
    writeFileSync(nestedConfig, built.text);

    const result = spawnSync('npx', [
      '--no-install',
      'wrangler',
      'versions',
      'upload',
      '--config',
      nestedConfig,
      '--preview-alias',
      'meta-k3-recovery',
      '--message',
      'meta-k3-dedicated-preview-dry-run',
      '--dry-run',
    ], {
      cwd: process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('K3 upload output is the recovery URL authority', () => {
  const origin =
    'https://meta-k3-recovery-social-mkt-sync-worker.example.workers.dev';
  const output = JSON.stringify({
    type: 'version-upload',
    version_id: VERSION,
    targets: [origin],
  });
  const parsed = parseMetaK3PreviewUpload(output, '', {
    previewAlias: 'meta-k3-recovery',
    accountWorkersDevSubdomain: 'example',
  });
  assert.equal(parsed.versionId, VERSION);
  assert.equal(parsed.previewOrigin, origin);
  assert.equal(
    parsed.recoveryUrl,
    `${origin}/operator/meta/k3-exact-partial-staging-continuation`,
  );
});

test('K3 Preview transport preserves Production deployment', () => {
  assert.deepEqual(validateMetaK3PreviewTransport({
    productionBaselineVersion: BASELINE,
    productionCurrentVersion: BASELINE,
    previewVersion: VERSION,
  }), {
    accepted: true,
    executionTransport: 'preview_version_upload',
    productionBaselineVersion: BASELINE,
    productionCurrentVersion: BASELINE,
    previewVersion: VERSION,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    workerDeploymentCount: 0,
    workerVersionUploadCount: 1,
  });
});

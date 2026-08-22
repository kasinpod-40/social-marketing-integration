import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = resolve(root, 'scripts/google-ads-manager-script-signed-delivery.js');
const manifestPath = resolve(root, 'docs/google-ads-manager-script-gaql-manifest-v1.json');

test('sanitized Manager Script is DRY_RUN-first and exact-account scoped', async () => {
  const script = await readFile(scriptPath, 'utf8');

  assert.match(script, /modeDefault:\s*'DRY_RUN'/u);
  assert.match(script, /deliveryEnabledDefault:\s*false/u);
  assert.match(script, /AdsManagerApp\.accounts\(\)\.withIds\(\[config\.customerId\]\)/u);
  assert.match(script, /executionCustomerId !== config\.managerCustomerId/u);
  assert.match(script, /selected !== config\.customerId/u);
  assert.match(script, /apiVersion:\s*'v24'/u);
  assert.match(
    script,
    /AdsApp\.search\(query,\s*\{\s*apiVersion:\s*GOOGLE_ADS_SIGNED_DELIVERY\.apiVersion/u,
  );
  assert.match(script, /MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID/u);
  assert.match(script, /FROM asset_group/u);
  assert.match(script, /function mapAssetGroupRow_/u);
  assert.doesNotMatch(script, /\basset\.status\b/u);
  assert.doesNotMatch(
    script,
    /\bmetrics\.(?:video_views|video_view_rate|average_cpv)\b/u,
  );
  assert.match(script, /function mapYoutubeAssetRow_[\s\S]*status:\s*null/u);
  assert.doesNotMatch(script, /MKT_GOOGLE_ADS_CUSTOMER_ID/u);
  assert.doesNotMatch(script, /(?<!\d)\d{10}(?!\d)/u);
});

test('sanitized Manager Script contains no trigger creation or Google Ads mutation surface', async () => {
  const script = await readFile(scriptPath, 'utf8');
  const forbiddenPatterns = [
    /ScriptApp\.newTrigger/u,
    /\.createCampaign\s*\(/u,
    /\.newAd\s*\(/u,
    /AdsApp\.mutate\s*\(/u,
    /\.apply\s*\(/u,
    /\.enable\s*\(/u,
    /\.pause\s*\(/u,
    /\.remove\s*\(/u,
    /SpreadsheetApp/u,
    /MailApp/u,
  ];
  for (const pattern of forbiddenPatterns) assert.doesNotMatch(script, pattern);

  assert.match(script, /if \(config\.mode === 'DRY_RUN'\)[\s\S]*return summary;/u);
  assert.match(
    script,
    /if \(config\.mode !== 'DRY_RUN' && !config\.deliveryEnabled\)[\s\S]*throw new Error/u,
  );
  assert.match(script, /UrlFetchApp\.fetch\(config\.endpoint/u);
});

test('GAQL manifest matches all seven bounded datasets and the exact script bytes', async () => {
  const [script, manifestText] = await Promise.all([
    readFile(scriptPath, 'utf8'),
    readFile(manifestPath, 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const expectedDatasets = [
    'account',
    'campaigns',
    'assetGroups',
    'adGroups',
    'ads',
    'youtubeAssets',
    'campaignDailyMetrics',
  ];

  assert.deepEqual(Object.keys(manifest.datasets), expectedDatasets);
  assert.equal(manifest.apiVersion, 'v24');
  assert.equal(manifest.sourceModeDefault, 'DRY_RUN');
  assert.equal(manifest.deliveryEnabledDefault, false);
  assert.equal(manifest.datasets.assetGroups.resource, 'asset_group');
  assert.deepEqual(manifest.datasets.youtubeAssets.nullableOutputOnly, ['status']);
  assert.equal(manifest.liveEvidence.currentSanitizedArtifactExternallyValidated, false);
  assert.equal(manifest.liveEvidence.assetGroupsExternallyValidated, false);
  assert.deepEqual(manifest.safetyScan, {
    containsCustomerId: false,
    containsSecret: false,
    createsTrigger: false,
    mutatesGoogleAds: false,
    writesExternalDataByDefault: false,
  });
  for (const dataset of Object.values(manifest.datasets)) {
    assert.equal(Number.isSafeInteger(dataset.maxRows), true);
    assert.equal(dataset.maxRows > 0, true);
    for (const field of dataset.fields) assert.match(script, new RegExp(escapeRegex(field), 'u'));
  }
  assert.equal(
    createHash('sha256').update(script).digest('hex'),
    manifest.scriptSha256,
  );
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

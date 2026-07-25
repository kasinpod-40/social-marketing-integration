import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const HELPER_URL = new URL(
  '../../scripts/google-ads-manager-script-provision-signing-secret.js',
  import.meta.url,
);

test('temporary Manager Script helper is placeholder-only and cannot enable delivery or log sensitive values', async () => {
  const source = await readFile(HELPER_URL, 'utf8');
  assert.match(source, /PASTE_ONE_TIME_TICKET_HERE/u);
  assert.match(source, /replace-with-api-worker\.example/u);
  assert.match(source, /managerCustomerId:\s*'0000000000'/u);
  assert.match(source, /customerId:\s*'0000000000'/u);
  assert.doesNotMatch(source, /MKT_GOOGLE_ADS_(?:MODE|DELIVERY_ENABLED)\s*:/u);
  assert.doesNotMatch(source, /ScriptApp|newTrigger|addCampaign|setBudget|setStatus/u);
  assert.equal((source.match(/Logger\.log\(/gu) ?? []).length, 1);
  assert.match(source, /Logger\.log\('GOOGLE_ADS_SIGNING_SECRET_PROVISIONING_CONFIRMED'\)/u);
  assert.match(source, /MKT_GOOGLE_ADS_SIGNING_KEY_ID/u);
  assert.match(source, /MKT_GOOGLE_ADS_SIGNING_SECRET/u);
  assert.match(source, /deleteProperty\('MKT_GOOGLE_ADS_SIGNING_KEY_ID'\)/u);
  assert.match(source, /deleteProperty\('MKT_GOOGLE_ADS_SIGNING_SECRET'\)/u);
});

test('temporary helper pins the exact provisioning protocol and refuses redirects', async () => {
  const source = await readFile(HELPER_URL, 'utf8');
  assert.match(source, /google_ads_signing_secret_provisioning_v1/u);
  assert.match(source, /MKT_PROVISIONING_REDEEM_PATH\s*=\s*'\/v1\/google-ads\/manager-script\/signing-secret\/redeem'/u);
  assert.match(source, /MKT_PROVISIONING_CONFIRM_PATH\s*=\s*'\/v1\/google-ads\/manager-script\/signing-secret\/confirm'/u);
  assert.match(source, /value\.schemaVersion\s*!==\s*MKT_PROVISIONING_SCHEMA_VERSION/u);
  assert.match(source, /value\.redeemPath\s*!==\s*MKT_PROVISIONING_REDEEM_PATH/u);
  assert.match(source, /value\.confirmPath\s*!==\s*MKT_PROVISIONING_CONFIRM_PATH/u);
  assert.match(source, /followRedirects:\s*false/u);
  assert.doesNotMatch(source, /\/deliveries/u);
});

test('temporary helper verifies exact Manager/advertiser, uses a 128-bit digest nonce and cleans up all write failures', async () => {
  const source = await readFile(HELPER_URL, 'utf8');
  assert.match(source, /AdsApp\.currentAccount\(\)\.getCustomerId\(\)/u);
  assert.match(source, /AdsManagerApp\.accounts\(\)\.withIds\(\[config\.customerId\]\)\.get\(\)/u);
  assert.match(source, /AdsManagerApp\.select\(account\)/u);
  assert.match(source, /Utilities\.getUuid\(\)\s*\+\s*':'\s*\+\s*Utilities\.getUuid\(\)/u);
  assert.match(source, /Utilities\.DigestAlgorithm\.SHA_256/u);
  assert.match(source, /digest\.slice\(0, 16\)/u);
  assert.match(
    source,
    /try\s*\{[\s\S]*?properties\.setProperties\([\s\S]*?\}\s*catch\s*\(error\)\s*\{[\s\S]*?deleteProperty\('MKT_GOOGLE_ADS_SIGNING_SECRET'\)/u,
  );
});

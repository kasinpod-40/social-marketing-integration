/**
 * Temporary Google Ads Manager Script helper for one-time Signing Secret provisioning.
 *
 * Safety boundary:
 * - Placeholder values only; never commit a real Ticket or customer identity.
 * - Writes only MKT_GOOGLE_ADS_SIGNING_KEY_ID and MKT_GOOGLE_ADS_SIGNING_SECRET.
 * - Does not enable delivery, PREVIEW/LIVE, schedules, triggers, Queue, Lark or Ads mutation.
 * - Remove this helper from the Google Ads Script immediately after a sanitized success.
 */
const MKT_PROVISIONING_SCHEMA_VERSION = 'google_ads_signing_secret_provisioning_v1';
const MKT_PROVISIONING_REDEEM_PATH = '/v1/google-ads/manager-script/signing-secret/redeem';
const MKT_PROVISIONING_CONFIRM_PATH = '/v1/google-ads/manager-script/signing-secret/confirm';
const MKT_PROVISIONING_RESPONSE_BYTES = 4096;

const MKT_SIGNING_SECRET_PROVISIONING = Object.freeze({
  schemaVersion: MKT_PROVISIONING_SCHEMA_VERSION,
  origin: 'https://replace-with-api-worker.example',
  redeemPath: MKT_PROVISIONING_REDEEM_PATH,
  confirmPath: MKT_PROVISIONING_CONFIRM_PATH,
  managerCustomerId: '0000000000',
  customerId: '0000000000',
  customerKey: 'replace-with-customer-key',
  accountKey: 'replace-with-account-key',
  keyId: 'replace-with-non-secret-key-id',
  oneTimeTicket: 'PASTE_ONE_TIME_TICKET_HERE',
  maximumResponseBytes: MKT_PROVISIONING_RESPONSE_BYTES,
});

function provisionGoogleAdsSigningSecretOnce() {
  const config = validateProvisioningConfig_(MKT_SIGNING_SECRET_PROVISIONING);
  selectProvisioningAdvertiser_(config);

  const properties = PropertiesService.getScriptProperties();
  const existingKeyId = properties.getProperty('MKT_GOOGLE_ADS_SIGNING_KEY_ID');
  const existingSecret = properties.getProperty('MKT_GOOGLE_ADS_SIGNING_SECRET');
  if (existingKeyId || existingSecret) {
    throw new Error('Signing properties already exist; review rotation separately');
  }

  const clientNonce = createProvisioningClientNonce_();
  const redeemPayload = canonicalJson_({
    schemaVersion: config.schemaVersion,
    managerCustomerId: config.managerCustomerId,
    customerId: config.customerId,
    customerKey: config.customerKey,
    accountKey: config.accountKey,
    keyId: config.keyId,
    clientNonce,
  });
  const redeemed = fetchProvisioningJson_(
    config.origin + config.redeemPath,
    config.oneTimeTicket,
    redeemPayload,
    null,
  );
  assertRedeemResponse_(redeemed, config.keyId);

  try {
    properties.setProperties({
      MKT_GOOGLE_ADS_SIGNING_KEY_ID: redeemed.keyId,
      MKT_GOOGLE_ADS_SIGNING_SECRET: redeemed.signingSecret,
    }, false);

    const confirmationPayload = canonicalJson_({
      schemaVersion: config.schemaVersion,
      managerCustomerId: config.managerCustomerId,
      customerId: config.customerId,
      customerKey: config.customerKey,
      accountKey: config.accountKey,
      keyId: config.keyId,
      clientNonce,
      challenge: redeemed.challenge,
    });
    const confirmationInput = [
      'MKT-GOOGLE-ADS-PROVISIONING-CONFIRM-V1',
      redeemed.keyId,
      clientNonce,
      redeemed.challenge,
    ].join('\n');
    const proof = 'sha256=' + bytesToHex_(Utilities.computeHmacSha256Signature(
      confirmationInput,
      redeemed.signingSecret,
      Utilities.Charset.UTF_8,
    ));
    const confirmed = confirmProvisioningWithRetry_(
      config.origin + config.confirmPath,
      config.oneTimeTicket,
      confirmationPayload,
      proof,
    );
    assertConfirmationResponse_(confirmed);
  } catch (error) {
    // Cleanup is unconditional because setProperties could fail after a partial provider-side write.
    properties.deleteProperty('MKT_GOOGLE_ADS_SIGNING_KEY_ID');
    properties.deleteProperty('MKT_GOOGLE_ADS_SIGNING_SECRET');
    throw error;
  }

  Logger.log('GOOGLE_ADS_SIGNING_SECRET_PROVISIONING_CONFIRMED');
}

function confirmProvisioningWithRetry_(url, ticket, payload, proof) {
  const delays = [1000, 2000];
  let lastError = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return fetchProvisioningJson_(url, ticket, payload, proof);
    } catch (error) {
      lastError = error;
      if (attempt < delays.length) Utilities.sleep(delays[attempt]);
    }
  }
  throw lastError || new Error('Provisioning confirmation failed');
}

function fetchProvisioningJson_(url, ticket, payload, proof) {
  const headers = { Authorization: 'Bearer ' + ticket };
  if (proof) headers['x-mkt-provisioning-proof'] = proof;
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload,
    muteHttpExceptions: true,
    followRedirects: false,
    headers,
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  if (utf8Bytes_(text) > MKT_PROVISIONING_RESPONSE_BYTES) {
    throw new Error('Provisioning response exceeded the byte limit');
  }
  if (status < 200 || status >= 300) {
    throw new Error('Provisioning request failed with HTTP ' + status);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error('Provisioning response was not JSON');
  }
}

function assertRedeemResponse_(value, expectedKeyId) {
  const fields = value && typeof value === 'object' ? Object.keys(value).sort() : [];
  if (
    fields.join(',') !== 'challenge,keyId,ok,signingSecret,status'
    || value.ok !== true
    || value.status !== 'redeemed_pending_confirmation'
    || value.keyId !== expectedKeyId
    || !/^[A-Za-z0-9_-]{43}$/.test(value.challenge || '')
    || utf8Bytes_(value.signingSecret || '') < 32
  ) throw new Error('Provisioning redeem response was invalid');
}

function assertConfirmationResponse_(value) {
  const fields = value && typeof value === 'object' ? Object.keys(value).sort() : [];
  if (
    fields.join(',') !== 'ok,status'
    || value.ok !== true
    || value.status !== 'confirmed'
  ) throw new Error('Provisioning confirmation was rejected');
}

function selectProvisioningAdvertiser_(config) {
  const managerId = normalizeCustomerId_(AdsApp.currentAccount().getCustomerId());
  if (managerId !== config.managerCustomerId) {
    throw new Error('Manager execution identity mismatch');
  }
  const iterator = AdsManagerApp.accounts().withIds([config.customerId]).get();
  if (!iterator.hasNext()) throw new Error('Allowlisted advertiser is not selectable');
  const account = iterator.next();
  if (iterator.hasNext()) throw new Error('Advertiser allowlist resolved more than once');
  AdsManagerApp.select(account);
  if (normalizeCustomerId_(AdsApp.currentAccount().getCustomerId()) !== config.customerId) {
    throw new Error('Selected advertiser identity mismatch');
  }
}

function validateProvisioningConfig_(value) {
  if (value.schemaVersion !== MKT_PROVISIONING_SCHEMA_VERSION) {
    throw new Error('Provisioning schema version is invalid');
  }
  if (value.redeemPath !== MKT_PROVISIONING_REDEEM_PATH) {
    throw new Error('Provisioning redeem path is invalid');
  }
  if (value.confirmPath !== MKT_PROVISIONING_CONFIRM_PATH) {
    throw new Error('Provisioning confirm path is invalid');
  }
  if (value.maximumResponseBytes !== MKT_PROVISIONING_RESPONSE_BYTES) {
    throw new Error('Provisioning response limit is invalid');
  }

  const origin = String(value.origin || '').replace(/\/+$/, '');
  if (
    !/^https:\/\/[^/?#]+$/.test(origin)
    || /replace-with|\.example(?::\d+)?$/i.test(origin)
  ) throw new Error('Provisioning origin placeholder must be replaced');

  const managerCustomerId = normalizeCustomerId_(value.managerCustomerId);
  const customerId = normalizeCustomerId_(value.customerId);
  if (!/^\d{10}$/.test(managerCustomerId) || /^0{10}$/.test(managerCustomerId)) {
    throw new Error('Manager customer ID placeholder must be replaced');
  }
  if (!/^\d{10}$/.test(customerId) || /^0{10}$/.test(customerId)) {
    throw new Error('Advertiser customer ID placeholder must be replaced');
  }
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.customerKey || '')
    || /^replace-with-/i.test(value.customerKey)
  ) throw new Error('Customer key placeholder must be replaced');
  if (
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.accountKey || '')
    || /^replace-with-/i.test(value.accountKey)
  ) throw new Error('Account key placeholder must be replaced');
  if (
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.keyId || '')
    || /^replace-with-/i.test(value.keyId)
  ) throw new Error('Signing key ID placeholder must be replaced');
  if (!/^[A-Za-z0-9_-]{43}$/.test(value.oneTimeTicket || '')) {
    throw new Error('One-time Ticket placeholder must be replaced');
  }
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    origin,
    redeemPath: value.redeemPath,
    confirmPath: value.confirmPath,
    managerCustomerId,
    customerId,
    customerKey: value.customerKey,
    accountKey: value.accountKey,
    keyId: value.keyId,
    oneTimeTicket: value.oneTimeTicket,
  });
}

function createProvisioningClientNonce_() {
  // Two independent UUIDv4 values provide more than 128 bits of input entropy.
  const seed = Utilities.getUuid() + ':' + Utilities.getUuid() + ':' + String(Date.now());
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    seed,
    Utilities.Charset.UTF_8,
  );
  return Utilities.base64EncodeWebSafe(digest.slice(0, 16)).replace(/=+$/g, '');
}

function canonicalJson_(value) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!isFinite(value)) throw new Error('Canonical JSON rejects non-finite numbers');
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson_).join(',') + ']';
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ':' + canonicalJson_(value[key]);
    }).join(',') + '}';
  }
  throw new Error('Canonical JSON rejects unsupported values');
}

function normalizeCustomerId_(value) {
  return String(value || '').replace(/-/g, '');
}

function utf8Bytes_(value) {
  return Utilities.newBlob(String(value || '')).getBytes().length;
}

function bytesToHex_(bytes) {
  return bytes.map(function (byte) {
    const normalized = byte < 0 ? byte + 256 : byte;
    return normalized.toString(16).padStart(2, '0');
  }).join('');
}

import { transientError } from '../../../shared/src/errors/runtime-error.js';

/** Read-only bridge from encrypted Customer Connection state to Google Ads LIVE admission. */
export class D1GoogleAdsCustomerConnectionReadStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async findValidatedConnection(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const advertiserCustomerId = normalizeCustomerId(
      input.advertiserCustomerId,
      'advertiserCustomerId',
    );
    let row;
    try {
      row = await this.db.prepare(`
        SELECT
          c.id,
          c.customer_key,
          c.connector_key,
          c.external_account_id,
          c.connection_status,
          c.access_status,
          c.granted_scopes_json,
          c.provider_metadata_json,
          c.last_validated_at,
          c.credential_reference,
          ec.credential_reference AS active_credential_reference,
          ec.key_version AS credential_key_version
        FROM connections AS c
        JOIN encrypted_credentials AS ec
          ON ec.connection_id = c.id
         AND ec.credential_kind = 'refresh_token'
         AND ec.status = 'active'
        WHERE c.customer_key = ?
          AND c.connector_key = 'google_ads'
          AND c.connection_status = 'connected'
          AND c.access_status = 'validated'
          AND REPLACE(c.external_account_id, '-', '') = ?
          AND c.credential_reference = ec.credential_reference
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 1
      `).bind(customerKey, advertiserCustomerId).first();
    } catch (cause) {
      throw transientError('Google Ads customer connection gate read failed', {
        code: 'GOOGLE_ADS_CONNECTION_GATE_READ_FAILED',
        cause,
      });
    }
    return row ? mapConnection(row) : null;
  }
}

function mapConnection(row) {
  return Object.freeze({
    connectionId: row.id,
    customerKey: row.customer_key,
    connectorKey: row.connector_key,
    advertiserCustomerId: normalizeCustomerId(row.external_account_id, 'externalAccountId'),
    connectionStatus: row.connection_status,
    accessStatus: row.access_status,
    grantedScopes: parseArray(row.granted_scopes_json),
    providerMetadata: parseObject(row.provider_metadata_json),
    lastValidatedAt: nullableTimestamp(row.last_validated_at),
    credentialReference: row.credential_reference,
    activeCredentialReference: row.active_credential_reference,
    credentialKeyVersion: row.credential_key_version,
  });
}

function parseArray(value) {
  if (!value) return Object.freeze([]);
  try {
    const parsed = JSON.parse(value);
    return Object.freeze(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    return Object.freeze([]);
  }
}

function parseObject(value) {
  if (!value) return Object.freeze({});
  try {
    const parsed = JSON.parse(value);
    return Object.freeze(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
  } catch {
    return Object.freeze({});
  }
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1GoogleAdsCustomerConnectionReadStore requires D1 prepare()');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function normalizeCustomerId(value, fieldName) {
  const id = requireText(value, fieldName).replaceAll('-', '');
  if (!/^\d{10}$/u.test(id)) throw new TypeError(`${fieldName} must be a 10-digit customer ID`);
  return id;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : Number(value);
}

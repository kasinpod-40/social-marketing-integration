import { transientError } from '../../../shared/src/errors/runtime-error.js';

/** Read-only bridge จาก Customer Connection state ไปยัง YouTube Owner Analytics admission. */
export class D1YouTubeCustomerConnectionReadStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async findOwnerAuthorizedConnection(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
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
          c.last_validated_at,
          c.last_error_code,
          c.credential_reference,
          ec.credential_reference AS active_credential_reference,
          ec.key_version AS credential_key_version
        FROM connections AS c
        LEFT JOIN encrypted_credentials AS ec
          ON ec.credential_reference = c.credential_reference
         AND ec.connection_id = c.id
         AND ec.credential_kind = 'refresh_token'
         AND ec.status = 'active'
        WHERE c.customer_key = ?
          AND c.connector_key = 'youtube'
        ORDER BY c.updated_at DESC, c.id DESC
        LIMIT 1
      `).bind(customerKey).first();
    } catch (cause) {
      throw transientError('YouTube customer connection gate read failed', {
        code: 'YOUTUBE_CONNECTION_GATE_READ_FAILED',
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
    externalAccountId: optionalText(row.external_account_id),
    connectionStatus: row.connection_status,
    accessStatus: row.access_status,
    grantedScopes: parseArray(row.granted_scopes_json),
    lastValidatedAt: nullableTimestamp(row.last_validated_at),
    lastErrorCode: optionalText(row.last_error_code),
    credentialReference: optionalText(row.credential_reference),
    activeCredentialReference: optionalText(row.active_credential_reference),
    credentialKeyVersion: optionalText(row.credential_key_version),
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

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1YouTubeCustomerConnectionReadStore requires D1 prepare()');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : Number(value);
}

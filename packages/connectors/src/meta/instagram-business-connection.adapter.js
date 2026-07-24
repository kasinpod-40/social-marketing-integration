import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const IDENTITY_FIELDS = 'user_id,id,account_type';

/** Instagram Login read-only identity adapter; Token นี้ไม่ใช้กับ Facebook หรือ Meta Ads */
export class InstagramBusinessConnectionAdapter {
  constructor(input = {}) {
    this.client = requireGraphClient(input.client);
  }

  async preflight(input = {}) {
    const expectedAccountId = optionalIdentity(input.expectedAccountId);
    const response = await this.client.get('me', { fields: IDENTITY_FIELDS });
    const accountId = requireIdentity(response?.user_id ?? response?.id);

    return Object.freeze({
      candidateCount: 1,
      mappingConfigured: expectedAccountId !== null,
      identityMatched: expectedAccountId === null
        ? false
        : accountId === expectedAccountId,
      accountType: optionalAccountType(response?.account_type),
      grantedPermissions: Object.freeze(['instagram_business_basic']),
    });
  }
}

function requireGraphClient(value) {
  if (typeof value?.get !== 'function') {
    throw new TypeError('InstagramBusinessConnectionAdapter requires client.get');
  }
  return value;
}

function requireIdentity(value) {
  const identity = optionalIdentity(value);
  if (!identity) {
    throw permanentError('Instagram identity response is missing user_id/id', {
      code: 'META_INVALID_RESPONSE',
    });
  }
  return identity;
}

function optionalIdentity(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function optionalAccountType(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return text || null;
}

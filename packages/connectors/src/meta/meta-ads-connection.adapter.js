import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const PERMISSIONS_FIELDS = 'permission,status';
const AD_ACCOUNT_FIELDS = 'id,account_id,account_status,currency,timezone_name';

/** Read-only Meta Ads account discovery adapter; ไม่อ่าน Campaign/Ad/Insights ใน Phase นี้ */
export class MetaAdsConnectionAdapter {
  constructor(input = {}) {
    this.client = requireGraphClient(input.client);
  }

  async preflight(input = {}) {
    const expectedAdAccountId = normalizeAdAccountId(input.expectedAdAccountId);
    const [permissionRows, adAccounts] = await Promise.all([
      this.client.listEdge(
        'me/permissions',
        { fields: PERMISSIONS_FIELDS },
        { operationName: 'meta_ads.preflight.permissions' },
      ),
      this.client.listEdge(
        'me/adaccounts',
        { fields: AD_ACCOUNT_FIELDS },
        { operationName: 'meta_ads.preflight.accounts' },
      ),
    ]);
    const accountIds = adAccounts.map((account) => requireAdAccountId(account));
    const activeCandidateCount = adAccounts.filter(
      (account) => Number(account?.account_status) === 1,
    ).length;

    return deepFreeze({
      candidateCount: accountIds.length,
      activeCandidateCount,
      mappingConfigured: expectedAdAccountId !== null,
      identityMatched: expectedAdAccountId === null
        ? false
        : accountIds.includes(expectedAdAccountId),
      grantedPermissions: readGrantedPermissions(permissionRows),
    });
  }
}

function readGrantedPermissions(rows) {
  const granted = rows
    .filter((row) => String(row?.status ?? '').trim().toLowerCase() === 'granted')
    .map((row) => optionalText(row?.permission))
    .filter(Boolean);
  return [...new Set(granted)].sort();
}

function requireAdAccountId(account) {
  const identity = normalizeAdAccountId(account?.account_id ?? account?.id);
  if (!identity) {
    throw permanentError('Meta Ad Account response is missing its identity', {
      code: 'META_INVALID_RESPONSE',
    });
  }
  return identity;
}

function normalizeAdAccountId(value) {
  const text = optionalText(value);
  return text ? text.replace(/^act_/iu, '') : null;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function requireGraphClient(value) {
  if (typeof value?.listEdge !== 'function') {
    throw new TypeError('MetaAdsConnectionAdapter requires client.listEdge');
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

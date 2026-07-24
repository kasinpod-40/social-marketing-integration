import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const PERMISSIONS_FIELDS = 'permission,status';
const PAGE_FIELDS = 'id,instagram_business_account{id}';

/** Read-only Facebook Page connection adapter; ไม่มี Method สำหรับ Provider mutation */
export class FacebookPageConnectionAdapter {
  constructor(input = {}) {
    this.client = requireGraphClient(input.client);
  }

  async preflight(input = {}) {
    const expectedPageId = optionalIdentity(input.expectedPageId);
    const [permissionRows, pages] = await Promise.all([
      this.client.listEdge(
        'me/permissions',
        { fields: PERMISSIONS_FIELDS },
        { operationName: 'facebook.preflight.permissions' },
      ),
      this.client.listEdge(
        'me/accounts',
        { fields: PAGE_FIELDS },
        { operationName: 'facebook.preflight.accounts' },
      ),
    ]);
    const pageIds = pages.map((page) => requireIdentity(page?.id, 'Facebook Page response'));
    const linkedInstagramCount = pages.filter(
      (page) => optionalIdentity(page?.instagram_business_account?.id),
    ).length;

    return deepFreeze({
      candidateCount: pageIds.length,
      linkedInstagramCount,
      mappingConfigured: expectedPageId !== null,
      identityMatched: expectedPageId === null
        ? false
        : pageIds.includes(expectedPageId),
      grantedPermissions: readGrantedPermissions(permissionRows),
    });
  }
}

function readGrantedPermissions(rows) {
  const granted = rows
    .filter((row) => String(row?.status ?? '').trim().toLowerCase() === 'granted')
    .map((row) => optionalIdentity(row?.permission))
    .filter(Boolean);
  return [...new Set(granted)].sort();
}

function requireGraphClient(value) {
  if (typeof value?.listEdge !== 'function') {
    throw new TypeError('FacebookPageConnectionAdapter requires client.listEdge');
  }
  return value;
}

function requireIdentity(value, source) {
  const identity = optionalIdentity(value);
  if (!identity) {
    throw permanentError(`${source} is missing its identity`, {
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

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

import { buildGoogleAdsDestinationRows, validateGoogleAdsDeliveryEnvelope } from '../google-ads/signed-delivery-contract.js';
import { isRetryableError, permanentError } from '../../../shared/src/errors/runtime-error.js';

const TABLE_CONTRACT = Object.freeze([
  ['raw.accounts', 'rawGoogleAdsAccounts', 'raw_account_key'],
  ['raw.campaigns', 'rawGoogleAdsCampaigns', 'raw_campaign_key'],
  ['raw.adGroups', 'rawGoogleAdsAdGroups', 'raw_ad_group_key'],
  ['raw.ads', 'rawGoogleAdsAds', 'raw_ad_key'],
  ['raw.assets', 'rawGoogleAdsAssets', 'raw_asset_key'],
  ['raw.daily', 'rawGoogleAdsDaily', 'raw_ads_daily_key'],
  ['canonical.accounts', 'mktAdsAccounts', 'ads_account_key'],
  ['canonical.campaigns', 'mktAdsCampaigns', 'campaign_key'],
  ['canonical.adGroups', 'mktAdsAdGroups', 'ad_group_key'],
  ['canonical.ads', 'mktAdsAds', 'ads_ad_key'],
  ['canonical.creatives', 'mktAdsCreatives', 'creative_key'],
  ['canonical.daily', 'mktAdsDaily', 'ads_daily_key'],
]);

/** Load one durable delivery, preflight every table, then execute idempotent upserts under the caller's distributed lock. */
export async function syncGoogleAdsManagerScriptDelivery(input = {}) {
  const store = requireMethod(input.deliveryStore, 'readDeliveryById');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireObject(input.syncEngine, 'syncEngine');
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const deliveryId = requireText(input.deliveryId, 'deliveryId');
  const tables = requireObject(input.tables, 'tables');

  const delivery = await store.readDeliveryById(deliveryId);
  if (delivery.status === 'completed') {
    return Object.freeze({ status: 'completed_idempotent', deliveryId, reconciliation: parseJson(delivery.reconciliationJson) });
  }
  if (delivery.mode !== 'LIVE') {
    throw permanentError('Preview delivery cannot enter the business write queue', {
      code: 'GOOGLE_ADS_PREVIEW_QUEUE_FORBIDDEN',
    });
  }

  await assertLockActive();
  await store.markProcessing(deliveryId);

  try {
    const envelope = validateGoogleAdsDeliveryEnvelope(parseJson(delivery.payloadJson));
    const rows = buildGoogleAdsDestinationRows(envelope);
    const plans = [];

    // Plan every table before the first write so schema/duplicate failures remain zero-write.
    for (const [path, tableKey, keyField] of TABLE_CONTRACT) {
      await assertLockActive();
      const tableId = requireText(tables[tableKey], tableKey);
      const tableRows = readPath(rows, path);
      const plan = await syncEngine.planByKey({ repository, tableId, keyField, rows: tableRows });
      plans.push({ path, tableKey, keyField, tableId, expected: tableRows.length, plan });
    }

    const tableResults = {};
    for (const item of plans) {
      await assertLockActive();
      const result = await syncEngine.executePlan(item.plan, { beforeWriteChunk: assertLockActive });
      const accounted = result.created + result.updated + result.skipped;
      if (accounted !== item.expected || result.duplicateInputRows !== 0) {
        throw permanentError('Google Ads table reconciliation failed', {
          code: 'GOOGLE_ADS_DELIVERY_RECONCILIATION_FAILED',
          details: { table: item.tableKey, expected: item.expected, accounted },
        });
      }
      tableResults[item.tableKey] = Object.freeze({ expected: item.expected, ...result });
    }

    const reconciliation = Object.freeze({
      schemaVersion: envelope.schemaVersion,
      datasetCounts: envelope.datasetCounts,
      canonicalDailyRows: rows.canonical.daily.length,
      tables: Object.freeze(tableResults),
    });
    await assertLockActive();
    await store.markCompleted({ deliveryId, reconciliation });
    return Object.freeze({ status: 'completed', deliveryId, reconciliation });
  } catch (error) {
    await store.markFailed({
      deliveryId,
      retryable: isRetryableError(error),
      errorCode: error?.code ?? 'GOOGLE_ADS_DELIVERY_PROCESSING_FAILED',
    });
    throw error;
  }
}

function readPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value) ?? [];
}
function parseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (cause) {
    throw permanentError('Persisted Google Ads delivery payload is invalid', {
      code: 'GOOGLE_ADS_DELIVERY_PAYLOAD_CORRUPT', cause,
    });
  }
}
function requireObject(value, label) { if (!value || typeof value !== 'object') throw new TypeError(`${label} is required`); return value; }
function requireMethod(value, method) { const object = requireObject(value, 'deliveryStore'); if (typeof object[method] !== 'function') throw new TypeError(`deliveryStore.${method} is required`); return object; }
function requireText(value, label) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`); return value.trim(); }

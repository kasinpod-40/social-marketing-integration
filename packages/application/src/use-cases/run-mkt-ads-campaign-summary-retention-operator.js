import { applySharedTableLarkSchema } from './apply-shared-table-lark-schema.js';
import {
  assertMktAdsMaintenanceIdle,
  materializeCampaignSummary,
  runMktAdsPostSyncMaintenance,
} from './mkt-ads-post-sync-maintenance.js';
import { previewSharedTableLarkSchema } from './preview-shared-table-lark-schema.js';
import {
  SHARED_TABLE_LARK_SCHEMA_VERSION,
  selectMktAdsCampaignSummaryLarkContract,
  validateMktAdsCampaignSummaryLarkSchema,
} from '../../../config/src/shared-table-lark-schema.js';

export const MKT_ADS_PROD_OPERATOR_VERSION = 'mkt-ads-campaign-summary-retention-operator-v1';

/**
 * One ordered, bounded Paid-only flow:
 * schema -> four Views -> current MTD materialization -> Ads Daily retention -> live verification.
 */
export async function runMktAdsCampaignSummaryRetentionOperator(input = {}) {
  const client = requireObject(input.client, 'client');
  const db = requireObject(input.db, 'db');
  const env = requireObject(input.env, 'env');
  const fullContract = requireObject(input.contract, 'contract');
  const contract = selectMktAdsCampaignSummaryLarkContract(fullContract);
  const schemaVersion = input.schemaVersion ?? SHARED_TABLE_LARK_SCHEMA_VERSION;
  const previewSchema = input.previewSchema ?? previewSharedTableLarkSchema;
  const applySchema = input.applySchema ?? applySharedTableLarkSchema;
  const runMaintenance = input.runMaintenance ?? runMktAdsPostSyncMaintenance;
  const rerunMaterialization = input.rerunMaterialization ?? materializeCampaignSummary;
  const preview = await previewSchema({
    client,
    env,
    ...contract,
    schemaVersion,
    validateSchema: validateMktAdsCampaignSummaryLarkSchema,
  });

  if (input.execute !== true) {
    return freeze({
      mode: 'preview',
      status: 'ready',
      operatorVersion: MKT_ADS_PROD_OPERATOR_VERSION,
      preview,
      safety: paidOnlySafety(),
    });
  }

  const now = normalizeNow(input.now?.() ?? Date.now());
  await assertMktAdsMaintenanceIdle({ db, now });
  const schemaApply = await applySchema({
    client,
    env,
    ...contract,
    schemaVersion,
    validateSchema: validateMktAdsCampaignSummaryLarkSchema,
    onProgress: input.onProgress,
  });
  const postSchemaEnv = { ...env, ...schemaApply.environmentUpdates };
  const summaryTableId = requiredText(
    postSchemaEnv.LARK_TABLE_MKT_ADS_CAMPAIGN_SUMMARY,
    'LARK_TABLE_MKT_ADS_CAMPAIGN_SUMMARY',
  );
  const dailyTableId = requiredText(env.LARK_TABLE_MKT_ADS_DAILY, 'LARK_TABLE_MKT_ADS_DAILY');
  const common = {
    db,
    client,
    repository: requireObject(input.repository, 'repository'),
    syncEngine: requireObject(input.syncEngine, 'syncEngine'),
    customerKey: requiredText(input.customerKey, 'customerKey'),
    timezone: requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone'),
    now: () => now,
    retentionDays: input.retentionDays,
    softLimit: input.softLimit,
    targetLimit: input.targetLimit,
    maxDeleteRows: input.maxDeleteRows,
    tables: {
      mktAdsCampaignSummary: summaryTableId,
      mktAdsDaily: dailyTableId,
    },
  };
  const maintenance = await runMaintenance({
    ...common,
    summaryEnabled: true,
    retentionEnabled: true,
  });
  const idempotencyRerun = await rerunMaterialization({
    ...common,
    tableId: summaryTableId,
    now,
  });
  if (idempotencyRerun.created !== 0 || idempotencyRerun.updated !== 0
    || idempotencyRerun.skipped !== idempotencyRerun.campaigns
    || idempotencyRerun.readback?.reconciled !== true) {
    throw operatorError(
      'Ads Campaign Summary idempotency rerun changed live records',
      'MKT_ADS_PROD_OPERATOR_IDEMPOTENCY_FAILED',
    );
  }
  const verification = await previewSchema({
    client,
    env: postSchemaEnv,
    ...contract,
    schemaVersion,
    validateSchema: validateMktAdsCampaignSummaryLarkSchema,
  });
  if (verification.actions.length > 0 || verification.conflicts.length > 0
    || verification.manualActions.length > 0 || verification.readyForApplyAuthorization !== true) {
    throw operatorError(
      'Ads Campaign Summary schema/View verification found live drift',
      'MKT_ADS_PROD_OPERATOR_SCHEMA_READBACK_FAILED',
    );
  }

  return freeze({
    mode: 'execute',
    status: 'completed',
    operatorVersion: MKT_ADS_PROD_OPERATOR_VERSION,
    tableIds: { mktAdsCampaignSummary: summaryTableId, mktAdsDaily: dailyTableId },
    schemaApply,
    maintenance,
    idempotencyRerun,
    verification,
    safety: paidOnlySafety(),
  });
}

function paidOnlySafety() {
  return Object.freeze({
    allowedTables: Object.freeze(['MKT_Ads_Campaign_Summary', 'MKT_Ads_Daily']),
    d1Mutations: 0,
    organicMutations: 0,
    maxDailyDeletesPerRun: 500,
  });
}

function normalizeNow(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError('now must be a positive timestamp');
  return Math.trunc(number);
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is required`);
  return value;
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} is required`);
  return value.trim();
}

function operatorError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

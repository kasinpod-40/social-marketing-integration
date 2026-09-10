import { applySharedTableLarkSchema } from './apply-shared-table-lark-schema.js';
import {
  assertMktAdsMaintenanceIdle,
  materializeCampaignSummaryHistory,
  runMktAdsPostSyncMaintenance,
} from './mkt-ads-post-sync-maintenance.js';
import { previewSharedTableLarkSchema } from './preview-shared-table-lark-schema.js';
import {
  SHARED_TABLE_LARK_SCHEMA_VERSION,
  MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME,
  MKT_ADS_CAMPAIGN_SUMMARY_GROUP_FIELD,
  MKT_ADS_CAMPAIGN_SUMMARY_VIEW_SORT,
  MKT_ADS_CAMPAIGN_SUMMARY_VISIBLE_FIELDS,
  selectMktAdsCampaignSummaryLarkContract,
  validateMktAdsCampaignSummaryLarkSchema,
} from '../../../config/src/shared-table-lark-schema.js';

export const MKT_ADS_PROD_OPERATOR_VERSION = 'mkt-ads-campaign-summary-retention-operator-v3';

/**
 * One ordered, bounded Paid-only flow:
 * schema -> table presentation -> current MTD/retention -> bounded history -> live verification.
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
  const materializeHistory = input.materializeHistory ?? materializeCampaignSummaryHistory;
  const rerunHistory = input.rerunHistory ?? materializeCampaignSummaryHistory;
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
      presentation: presentationContract(),
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
  const tablePresentation = await ensureCampaignSummaryTableName({ client, tableId: summaryTableId });
  const viewPresentation = await ensureCampaignSummaryViewPresentation({
    client,
    tableId: summaryTableId,
  });
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
  const history = await materializeHistory({
    ...common,
    tableId: summaryTableId,
    now,
    historyStart: input.historyStart,
  });
  const historyIdempotencyRerun = await rerunHistory({
    ...common,
    tableId: summaryTableId,
    now,
    historyStart: input.historyStart,
  });
  if (historyIdempotencyRerun.created !== 0 || historyIdempotencyRerun.updated !== 0
    || historyIdempotencyRerun.skipped !== historyIdempotencyRerun.campaigns
    || historyIdempotencyRerun.readback?.reconciled !== true) {
    throw operatorError(
      'Ads Campaign Summary history idempotency rerun changed live records',
      'MKT_ADS_PROD_OPERATOR_HISTORY_IDEMPOTENCY_FAILED',
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
    tablePresentation,
    viewPresentation,
    maintenance,
    history,
    historyIdempotencyRerun,
    presentation: presentationContract(),
    verification,
    safety: paidOnlySafety(),
  });
}

async function ensureCampaignSummaryViewPresentation({ client, tableId }) {
  const methods = [
    'listViews', 'getViewGroup', 'setViewGroup', 'getViewSort', 'setViewSort',
    'getViewVisibleFields', 'setViewVisibleFields',
  ];
  for (const method of methods) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Ads Campaign Summary View presentation requires ${method}`);
    }
  }
  const viewNames = ['📊 Overview', '🔵 Meta', '🔴 Google', '⚫ TikTok'];
  const listed = await client.listViews({ tableId });
  const byName = new Map(listed.map((view) => [view?.viewName, view]));
  const groupConfig = [{ field: MKT_ADS_CAMPAIGN_SUMMARY_GROUP_FIELD, desc: true }];
  const sortConfig = MKT_ADS_CAMPAIGN_SUMMARY_VIEW_SORT.map((entry) => ({ ...entry }));
  const visibleFields = [...MKT_ADS_CAMPAIGN_SUMMARY_VISIBLE_FIELDS];
  const results = [];

  for (const viewName of viewNames) {
    const view = byName.get(viewName);
    if (!view?.viewId) {
      throw operatorError(
        `Ads Campaign Summary View is absent: ${viewName}`,
        'MKT_ADS_PROD_OPERATOR_VIEW_READBACK_FAILED',
      );
    }
    const target = { tableId, viewId: view.viewId };
    const before = await readViewPresentation(client, target);
    const actions = [];
    if (!sameValue(before.groupConfig, groupConfig)) {
      await client.setViewGroup({ ...target, groupConfig });
      actions.push('group');
    }
    if (!sameValue(before.sortConfig, sortConfig)) {
      await client.setViewSort({ ...target, sortConfig });
      actions.push('sort');
    }
    if (!sameValue(before.visibleFields, visibleFields)) {
      await client.setViewVisibleFields({ ...target, visibleFields });
      actions.push('visible_fields');
    }
    const after = await readViewPresentation(client, target);
    if (!sameValue(after.groupConfig, groupConfig)
      || !sameValue(after.sortConfig, sortConfig)
      || !sameValue(after.visibleFields, visibleFields)) {
      throw operatorError(
        `Ads Campaign Summary View presentation readback failed: ${viewName}`,
        'MKT_ADS_PROD_OPERATOR_VIEW_PRESENTATION_FAILED',
        {
          viewName,
          expected: { groupConfig, sortConfig, visibleFields },
          actual: after,
        },
      );
    }
    results.push(freeze({ viewId: view.viewId, viewName, actions, ...after }));
  }
  return freeze({ views: results, mutatedViews: results.filter((view) => view.actions.length > 0).length });
}

async function readViewPresentation(client, target) {
  const [group, sort, visible] = await Promise.all([
    client.getViewGroup(target),
    client.getViewSort(target),
    client.getViewVisibleFields(target),
  ]);
  return {
    groupConfig: group.groupConfig,
    sortConfig: sort.sortConfig,
    visibleFields: visible.visibleFields,
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function ensureCampaignSummaryTableName({ client, tableId }) {
  if (typeof client.listTables !== 'function' || typeof client.renameTable !== 'function') {
    throw new TypeError('Ads Campaign Summary presentation requires listTables/renameTable');
  }
  const before = await client.listTables();
  const table = before.find((candidate) => candidate?.tableId === tableId);
  if (!table) {
    throw operatorError(
      'Ads Campaign Summary table ID is absent from the Customer Base',
      'MKT_ADS_PROD_OPERATOR_TABLE_READBACK_FAILED',
    );
  }
  if (table.name !== MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME) {
    await client.renameTable({ tableId, name: MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME });
  }
  const after = await client.listTables();
  const readback = after.find((candidate) => candidate?.tableId === tableId);
  if (readback?.name !== MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME) {
    throw operatorError(
      'Ads Campaign Summary table rename readback failed',
      'MKT_ADS_PROD_OPERATOR_TABLE_RENAME_FAILED',
    );
  }
  return freeze({
    tableId,
    name: readback.name,
    renamed: table.name !== MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME,
    preservedTableId: true,
  });
}

function presentationContract() {
  return freeze({
    tableName: MKT_ADS_CAMPAIGN_SUMMARY_DISPLAY_NAME,
    groupBy: MKT_ADS_CAMPAIGN_SUMMARY_GROUP_FIELD,
    groupNewestFirst: true,
    sort: MKT_ADS_CAMPAIGN_SUMMARY_VIEW_SORT.map((entry) => ({ ...entry })),
    visibleFields: [...MKT_ADS_CAMPAIGN_SUMMARY_VISIBLE_FIELDS],
    views: ['📊 Overview', '🔵 Meta', '🔴 Google', '⚫ TikTok'],
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

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = freeze(details);
  return error;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

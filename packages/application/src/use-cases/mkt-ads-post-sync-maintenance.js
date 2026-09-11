import { calculateAdsDerivedMetrics } from '../../../domain/src/entities/ads.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { createExplicitNullUpdateRepository } from '../../../sync-engine/src/explicit-null-update-repository.js';

export const MKT_ADS_MAINTENANCE_VERSION = 'mkt-ads-post-sync-maintenance-v3';
export const MKT_ADS_DAILY_RETENTION_DAYS = 90;
export const MKT_ADS_DAILY_SOFT_LIMIT = 17_000;
export const MKT_ADS_DAILY_TARGET_LIMIT = 15_000;
export const MKT_ADS_DAILY_MAX_DELETE_ROWS = 500;
export const MKT_ADS_CAMPAIGN_SUMMARY_PERIOD_KIND = 'mtd';
export const MKT_ADS_CAMPAIGN_SUMMARY_HISTORY_START = '2026-06-19';

const MAX_CAMPAIGN_SUMMARY_ROWS = 1_000;
const D1_IDENTITY_BATCH_SIZE = 40;
const TERMINAL_MAINTENANCE_PLATFORMS = new Set(['meta_ads', 'google_ads', 'tiktok_ads']);
const CAMPAIGN_SUMMARY_NULLABLE_FIELDS = Object.freeze([
  'campaign_name', 'status', 'currency', 'spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm',
  'conversions', 'cpa', 'conversion_value', 'roas',
]);

/**
 * Shared paid-Ads post-sync maintenance.
 *
 * D1 remains the historical authority. Campaign Summary is rebuilt from D1 MTD facts and
 * MKT_Ads_Daily is treated only as a bounded Lark cache. Retention deletes only exact Lark
 * record IDs whose platform/account/entity/date identity can be proven to exist in D1.
 */
export async function runMktAdsPostSyncMaintenance(input = {}) {
  const summaryEnabled = input.summaryEnabled === true;
  const retentionEnabled = input.retentionEnabled === true;
  if (!summaryEnabled && !retentionEnabled) {
    return Object.freeze({
      status: 'disabled',
      contractVersion: MKT_ADS_MAINTENANCE_VERSION,
      summary: null,
      retention: null,
    });
  }

  const db = requireDb(input.db);
  const now = normalizeNow(input.now?.() ?? Date.now());
  const timezone = requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone');
  const client = requireClient(input.client);
  const tables = requireObject(input.tables, 'tables');

  const summaryTableId = summaryEnabled
    ? requiredText(tables.mktAdsCampaignSummary, 'tables.mktAdsCampaignSummary')
    : null;
  const monthOption = summaryEnabled
    ? await ensureCampaignSummaryMonthOption({
      client,
      tableId: summaryTableId,
      timezone,
      now,
    })
    : null;
  const summary = summaryEnabled
    ? await materializeCampaignSummary({
      db,
      repository: requireObject(input.repository, 'repository'),
      syncEngine: requireSyncEngine(input.syncEngine),
      tableId: summaryTableId,
      customerKey: requiredText(input.customerKey, 'customerKey'),
      timezone,
      now,
    })
    : null;

  const retention = retentionEnabled
    ? await retainAdsDailyCache({
      db,
      client,
      tableId: requiredText(tables.mktAdsDaily, 'tables.mktAdsDaily'),
      customerKey: requiredText(input.customerKey, 'customerKey'),
      timezone,
      now,
      retentionDays: positiveInteger(
        input.retentionDays ?? MKT_ADS_DAILY_RETENTION_DAYS,
        'retentionDays',
      ),
      softLimit: positiveInteger(
        input.softLimit ?? MKT_ADS_DAILY_SOFT_LIMIT,
        'softLimit',
      ),
      targetLimit: positiveInteger(
        input.targetLimit ?? MKT_ADS_DAILY_TARGET_LIMIT,
        'targetLimit',
      ),
      maxDeleteRows: boundedPositiveInteger(
        input.maxDeleteRows ?? MKT_ADS_DAILY_MAX_DELETE_ROWS,
        'maxDeleteRows',
        MKT_ADS_DAILY_MAX_DELETE_ROWS,
      ),
    })
    : null;

  return Object.freeze({
    status: 'completed',
    contractVersion: MKT_ADS_MAINTENANCE_VERSION,
    monthOption,
    summary,
    retention,
  });
}

/**
 * เพิ่มตัวเลือกเดือนปัจจุบันเมื่อขึ้นเดือนใหม่เท่านั้น เพื่อให้ Daily runtime เขียน
 * Single Select ได้ต่อเนื่องโดยไม่ต้อง Provision schema ซ้ำทุกวัน.
 */
export async function ensureCampaignSummaryMonthOption(input = {}) {
  const client = requireObject(input.client, 'client');
  if (typeof client.listFields !== 'function' || typeof client.updateField !== 'function') {
    throw new TypeError('Ads Campaign Summary month option requires listFields/updateField');
  }
  const tableId = requiredText(input.tableId, 'tableId');
  const timezone = requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone');
  const now = normalizeNow(input.now ?? Date.now());
  const period = monthToDatePeriod(now, timezone);
  const label = campaignSummaryThaiMonthLabel(period.periodStart);
  const fields = await client.listFields({ tableId });
  const matches = fields.filter((field) => field?.fieldName === 'period_month_th');
  if (matches.length !== 1) {
    throw maintenanceError(
      'Ads Campaign Summary month field identity is missing or ambiguous',
      'MKT_ADS_CAMPAIGN_SUMMARY_MONTH_FIELD_INVALID',
    );
  }
  const field = matches[0];
  // ช่วง Deploy ก่อน controlled migration ยังเป็น Text อยู่ได้ชั่วคราว และเขียน label ใหม่ได้อย่างปลอดภัย.
  if (Number(field.type) === 1) {
    return Object.freeze({ status: 'legacy_text', label, mutated: false });
  }
  if (Number(field.type) !== 3) {
    throw maintenanceError(
      'Ads Campaign Summary month field must be Text or Single Select',
      'MKT_ADS_CAMPAIGN_SUMMARY_MONTH_FIELD_TYPE_INVALID',
    );
  }
  const existingOptions = Array.isArray(field.property?.options) ? field.property.options : [];
  if (existingOptions.some((option) => option?.name === label)) {
    return Object.freeze({ status: 'ready', label, mutated: false });
  }
  const nextOptions = [
    ...existingOptions,
    { name: label, color: existingOptions.length % 8 },
  ];
  await client.updateField({
    tableId,
    fieldId: requiredText(field.fieldId, 'period_month_th.fieldId'),
    field: {
      fieldName: 'period_month_th',
      type: 3,
      uiType: 'SingleSelect',
      description: field.description,
      property: { ...field.property, options: nextOptions },
    },
  });
  const readback = (await client.listFields({ tableId }))
    .filter((candidate) => candidate?.fieldName === 'period_month_th');
  if (readback.length !== 1 || Number(readback[0].type) !== 3
    || !(readback[0].property?.options ?? []).some((option) => option?.name === label)) {
    throw maintenanceError(
      'Ads Campaign Summary month option readback failed',
      'MKT_ADS_CAMPAIGN_SUMMARY_MONTH_OPTION_READBACK_FAILED',
    );
  }
  return Object.freeze({ status: 'added', label, mutated: true });
}

export async function materializeCampaignSummary(input = {}) {
  const db = requireDb(input.db);
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireSyncEngine(input.syncEngine);
  const tableId = requiredText(input.tableId, 'tableId');
  const customerKey = requiredText(input.customerKey, 'customerKey');
  const timezone = requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone');
  const now = normalizeNow(input.now ?? Date.now());
  const period = monthToDatePeriod(now, timezone);
  const materialized = await materializeCampaignSummaryPeriods({
    db,
    repository,
    syncEngine,
    tableId,
    customerKey,
    timezone,
    now,
    periods: [period],
  });
  return Object.freeze({
    periodKind: MKT_ADS_CAMPAIGN_SUMMARY_PERIOD_KIND,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    ...materialized,
  });
}

/**
 * Controlled historical materialization. This is deliberately separate from the normal daily
 * maintenance path so scheduled syncs continue to rebuild only the current MTD bucket.
 */
export async function materializeCampaignSummaryHistory(input = {}) {
  const db = requireDb(input.db);
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireSyncEngine(input.syncEngine);
  const tableId = requiredText(input.tableId, 'tableId');
  const customerKey = requiredText(input.customerKey, 'customerKey');
  const timezone = requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone');
  const now = normalizeNow(input.now ?? Date.now());
  const historyStart = dateOnly(input.historyStart ?? MKT_ADS_CAMPAIGN_SUMMARY_HISTORY_START, 'historyStart');
  const periods = calendarMonthPeriods(historyStart, now, timezone);
  const materialized = await materializeCampaignSummaryPeriods({
    db,
    repository,
    syncEngine,
    tableId,
    customerKey,
    timezone,
    now,
    periods,
  });
  return Object.freeze({
    periodKind: MKT_ADS_CAMPAIGN_SUMMARY_PERIOD_KIND,
    historyStart,
    periodStart: periods[0].periodStart,
    periodEnd: periods.at(-1).periodEnd,
    months: periods.length,
    periods: Object.freeze(periods.map((period) => Object.freeze({ ...period }))),
    ...materialized,
  });
}

async function materializeCampaignSummaryPeriods(input) {
  const larkRows = [];
  for (const period of input.periods) {
    const rows = await readCampaignPeriodRows({
      db: input.db,
      customerKey: input.customerKey,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });
    larkRows.push(...rows.map((row) => campaignSummaryRow(
      row,
      period,
      input.timezone,
      input.now,
    )));
    if (larkRows.length > MAX_CAMPAIGN_SUMMARY_ROWS) {
      throw maintenanceError(
        `Ads Campaign Summary exceeds bounded materialization limit ${MAX_CAMPAIGN_SUMMARY_ROWS}`,
        'MKT_ADS_CAMPAIGN_SUMMARY_BOUND_EXCEEDED',
      );
    }
  }
  const exactRepository = createExplicitNullUpdateRepository({
    repository: input.repository,
    fieldNames: CAMPAIGN_SUMMARY_NULLABLE_FIELDS,
  });
  const plan = await input.syncEngine.planByKey({
    repository: exactRepository,
    tableId: input.tableId,
    keyField: 'campaign_summary_key',
    rows: larkRows,
  });
  if (Number(plan?.duplicateInputRows ?? 0) !== 0) {
    throw maintenanceError(
      'Ads Campaign Summary contains duplicate stable keys',
      'MKT_ADS_CAMPAIGN_SUMMARY_DUPLICATE_KEY',
    );
  }
  const result = await input.syncEngine.executePlan(plan);
  const accounted = Number(result?.created ?? 0) + Number(result?.updated ?? 0) + Number(result?.skipped ?? 0);
  if (accounted !== larkRows.length || Number(result?.duplicateInputRows ?? 0) !== 0) {
    throw maintenanceError(
      'Ads Campaign Summary Lark reconciliation failed',
      'MKT_ADS_CAMPAIGN_SUMMARY_RECONCILIATION_FAILED',
    );
  }
  const readbackPlan = await input.syncEngine.planByKey({
    repository: exactRepository,
    tableId: input.tableId,
    keyField: 'campaign_summary_key',
    rows: larkRows,
  });
  if (Number(readbackPlan?.duplicateInputRows ?? 0) !== 0
    || Number(readbackPlan?.createRows?.length ?? -1) !== 0
    || Number(readbackPlan?.updateRows?.length ?? -1) !== 0
    || Number(readbackPlan?.skipped ?? -1) !== larkRows.length) {
    throw maintenanceError(
      'Ads Campaign Summary live readback does not match the exact D1 projection',
      'MKT_ADS_CAMPAIGN_SUMMARY_READBACK_FAILED',
    );
  }
  return Object.freeze({
    campaigns: larkRows.length,
    created: Number(result?.created ?? 0),
    updated: Number(result?.updated ?? 0),
    skipped: Number(result?.skipped ?? 0),
    readback: Object.freeze({
      reconciled: true,
      identities: larkRows.length,
      values: larkRows.length,
      duplicateStableKeys: 0,
    }),
  });
}

export async function retainAdsDailyCache(input = {}) {
  const db = requireDb(input.db);
  const client = requireClient(input.client);
  const tableId = requiredText(input.tableId, 'tableId');
  const customerKey = requiredText(input.customerKey, 'customerKey');
  const timezone = requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone');
  const now = normalizeNow(input.now ?? Date.now());
  const retentionDays = positiveInteger(input.retentionDays ?? MKT_ADS_DAILY_RETENTION_DAYS, 'retentionDays');
  const softLimit = positiveInteger(input.softLimit ?? MKT_ADS_DAILY_SOFT_LIMIT, 'softLimit');
  const targetLimit = positiveInteger(input.targetLimit ?? MKT_ADS_DAILY_TARGET_LIMIT, 'targetLimit');
  const maxDeleteRows = boundedPositiveInteger(
    input.maxDeleteRows ?? MKT_ADS_DAILY_MAX_DELETE_ROWS,
    'maxDeleteRows',
    MKT_ADS_DAILY_MAX_DELETE_ROWS,
  );
  if (targetLimit >= softLimit) {
    throw new TypeError('targetLimit must be lower than softLimit');
  }

  await assertNoActiveSyncLocks(db, now);
  const recordsBefore = await countLarkRecords(client, tableId);
  const cutoffDate = retentionCutoffDate(now, timezone, retentionDays);
  const cutoffEpoch = dateOnlyInTimeZoneToEpochMilliseconds(cutoffDate, timezone, {
    label: 'Ads Daily retention cutoff',
  });
  const requestedForPressure = recordsBefore >= softLimit
    ? Math.min(maxDeleteRows, Math.max(0, recordsBefore - targetLimit))
    : 0;

  const candidates = [];
  const byRecordId = new Set();
  await appendCandidates({
    client,
    tableId,
    candidates,
    byRecordId,
    limit: maxDeleteRows,
    filter: {
      conjunction: 'and',
      // Lark DateTime record filters require the explicit ExactDate discriminator.
      conditions: [{
        fieldName: 'metric_date',
        operator: 'isLess',
        value: ['ExactDate', String(cutoffEpoch)],
      }],
    },
  });
  if (requestedForPressure > candidates.length && candidates.length < maxDeleteRows) {
    await appendCandidates({
      client,
      tableId,
      candidates,
      byRecordId,
      limit: Math.min(maxDeleteRows, requestedForPressure),
    });
  }

  const normalized = candidates.map((record) => normalizeDailyCandidate(record, timezone)).filter(Boolean);
  const verified = await verifyD1DailyIdentities({ db, customerKey, candidates: normalized });
  const safeDeletes = normalized.filter((row) => verified.has(row.identityKey)).slice(0, maxDeleteRows);
  const safetyBlocked = candidates.length - safeDeletes.length;

  let deleted = 0;
  if (safeDeletes.length > 0) {
    const result = await client.batchDeleteRecords({
      tableId,
      recordIds: safeDeletes.map((row) => row.recordId),
      beforeChunk: () => assertNoActiveSyncLocks(db, Date.now()),
    });
    deleted = Number(result?.deleted ?? 0);
    if (deleted !== safeDeletes.length) {
      throw maintenanceError(
        'Ads Daily retention delete count did not match the D1-proven plan',
        'MKT_ADS_DAILY_RETENTION_DELETE_COUNT_MISMATCH',
      );
    }
    const surviving = await client.searchRecordsByFieldValues({
      tableId,
      fieldName: 'ads_daily_key',
      values: safeDeletes.map((row) => row.stableKey),
      includeRecordMetadata: false,
    });
    if (surviving.length > 0) {
      throw maintenanceError(
        'Ads Daily retention readback found deleted stable keys still present',
        'MKT_ADS_DAILY_RETENTION_READBACK_FAILED',
      );
    }
  }

  const recordsAfter = deleted > 0 ? await countLarkRecords(client, tableId) : recordsBefore;
  return Object.freeze({
    recordsBefore,
    recordsAfter,
    retentionDays,
    cutoffDate,
    softLimit,
    targetLimit,
    maxDeleteRows,
    pressureTriggered: recordsBefore >= softLimit,
    candidates: normalized.length,
    d1Verified: safeDeletes.length,
    safetyBlocked,
    deleted,
    d1Mutations: 0,
  });
}

/** Read-only gate shared by the controlled operator before any schema or business mutation. */
export async function assertMktAdsMaintenanceIdle(input = {}) {
  return assertNoActiveSyncLocks(requireDb(input.db), normalizeNow(input.now ?? Date.now()));
}

async function readCampaignPeriodRows({ db, customerKey, periodStart, periodEnd }) {
  const result = await db.prepare(`
    SELECT
      f.platform,
      f.account_key,
      f.source_account_id,
      f.external_campaign_id,
      MAX(f.currency) AS currency,
      MAX(c.entity_name) AS campaign_name,
      MAX(c.status) AS status,
      SUM(f.spend_micros) AS spend_micros,
      SUM(f.impressions) AS impressions,
      SUM(f.clicks) AS clicks,
      SUM(f.conversions) AS conversions,
      SUM(f.conversion_value_micros) AS conversion_value_micros,
      MAX(f.fetched_at) AS source_fetched_at
    FROM ads_daily_facts f
    LEFT JOIN ads_entity_state c
      ON c.customer_key = f.customer_key
      AND c.platform = f.platform
      AND c.account_key = f.account_key
      AND c.entity_type = 'campaign'
      AND c.external_entity_id = f.external_campaign_id
    WHERE f.customer_key = ?
      AND f.external_campaign_id IS NOT NULL
      AND f.platform IN ('meta_ads', 'google_ads', 'tiktok_ads')
      AND f.metric_date >= ?
      AND f.metric_date <= ?
      AND (
        (f.platform = 'meta_ads' AND f.report_level = 'ad')
        OR (f.platform = 'google_ads' AND f.report_level = 'campaign')
        OR (f.platform NOT IN ('meta_ads', 'google_ads') AND f.report_level = 'campaign')
      )
    GROUP BY
      f.platform, f.account_key, f.source_account_id, f.external_campaign_id
    ORDER BY f.platform, f.source_account_id, f.external_campaign_id
    LIMIT ?
  `).bind(customerKey, periodStart, periodEnd, MAX_CAMPAIGN_SUMMARY_ROWS + 1).all();
  const rows = Array.isArray(result) ? result : (result?.results ?? []);
  if (rows.length > MAX_CAMPAIGN_SUMMARY_ROWS) {
    throw maintenanceError(
      `Ads Campaign Summary exceeds bounded D1 result limit ${MAX_CAMPAIGN_SUMMARY_ROWS}`,
      'MKT_ADS_CAMPAIGN_SUMMARY_BOUND_EXCEEDED',
    );
  }
  return rows;
}

function campaignSummaryRow(row, period, timezone, now) {
  const platform = requiredText(row.platform, 'campaign.platform').toLowerCase();
  const accountId = requiredText(row.source_account_id, 'campaign.source_account_id');
  const campaignId = requiredText(row.external_campaign_id, 'campaign.external_campaign_id');
  const metrics = {
    spend_micros: nullableNumber(row.spend_micros),
    impressions: nullableNumber(row.impressions),
    clicks: nullableNumber(row.clicks),
    conversions: nullableNumber(row.conversions),
    conversion_value_micros: nullableNumber(row.conversion_value_micros),
  };
  const derived = calculateAdsDerivedMetrics(metrics);
  const sourceFetchedAt = nullableNumber(row.source_fetched_at);
  return Object.freeze({
    campaign_summary_key: `${platform}:${accountId}:${campaignId}:mtd:${period.periodStart.slice(0, 7)}`,
    period_kind: MKT_ADS_CAMPAIGN_SUMMARY_PERIOD_KIND,
    period_month_th: campaignSummaryThaiMonthLabel(period.periodStart),
    period_start: dateOnlyInTimeZoneToEpochMilliseconds(period.periodStart, timezone, {
      label: 'Ads Campaign Summary period start',
    }),
    period_end: dateOnlyInTimeZoneToEpochMilliseconds(period.periodEnd, timezone, {
      label: 'Ads Campaign Summary period end',
    }),
    platform,
    account_id: accountId,
    campaign_id: campaignId,
    campaign_name: optionalText(row.campaign_name),
    status: optionalText(row.status),
    currency: optionalText(row.currency),
    spend: metrics.spend_micros === null ? null : metrics.spend_micros / 1_000_000,
    impressions: metrics.impressions,
    clicks: metrics.clicks,
    ctr: derived.ctr,
    cpc: derived.cpc,
    cpm: derived.cpm,
    conversions: metrics.conversions,
    cpa: derived.cpa,
    conversion_value: metrics.conversion_value_micros === null
      ? null
      : metrics.conversion_value_micros / 1_000_000,
    roas: derived.actual_roas,
    last_synced_at: sourceFetchedAt === null ? now : Math.trunc(sourceFetchedAt),
  });
}

async function appendCandidates(input) {
  if (input.candidates.length >= input.limit) return;
  const remaining = input.limit - input.candidates.length;
  const records = await input.client.searchRecords({
    tableId: input.tableId,
    fieldNames: [
      'ads_daily_key', 'metric_date', 'platform', 'account_id', 'entity_type', 'external_entity_id',
    ],
    ...(input.filter ? { filter: input.filter } : {}),
    sort: [{ fieldName: 'metric_date', desc: false }],
    pageSize: Math.min(remaining, 500),
    maxPages: 2,
    stopWhen: ({ totalRows }) => totalRows >= remaining,
  });
  for (const record of records) {
    const recordId = optionalText(record?.recordId ?? record?.record_id);
    if (!recordId || input.byRecordId.has(recordId)) continue;
    input.byRecordId.add(recordId);
    input.candidates.push(record);
    if (input.candidates.length >= input.limit) break;
  }
}

function normalizeDailyCandidate(record, timezone) {
  const recordId = optionalText(record?.recordId ?? record?.record_id);
  const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
  const stableKey = readLarkText(fields.ads_daily_key);
  const platform = readLarkText(fields.platform)?.toLowerCase();
  const accountId = readLarkText(fields.account_id);
  const entityType = readLarkText(fields.entity_type)?.toLowerCase();
  const externalEntityId = readLarkText(fields.external_entity_id);
  const metricDate = metricDateFromStableKey(stableKey);
  if (!recordId || !stableKey || !platform || !accountId || !entityType || !externalEntityId || !metricDate) {
    return null;
  }
  if (!TERMINAL_MAINTENANCE_PLATFORMS.has(platform)) return null;
  const expectedPrefix = `${platform}:${accountId}:${entityType}:${externalEntityId}:`;
  if (!stableKey.startsWith(expectedPrefix)) return null;
  const expectedMetricDateEpoch = dateOnlyInTimeZoneToEpochMilliseconds(metricDate, timezone, {
    label: 'Ads Daily stable-key metric date',
  });
  const larkMetricDateEpoch = readLarkEpoch(fields.metric_date);
  if (larkMetricDateEpoch !== expectedMetricDateEpoch) return null;
  return Object.freeze({
    recordId,
    stableKey,
    platform,
    accountId,
    entityType,
    externalEntityId,
    metricDate,
    identityKey: dailyIdentityKey({ platform, accountId, entityType, externalEntityId, metricDate }),
  });
}

async function verifyD1DailyIdentities({ db, customerKey, candidates }) {
  const verified = new Set();
  for (let offset = 0; offset < candidates.length; offset += D1_IDENTITY_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + D1_IDENTITY_BATCH_SIZE);
    if (batch.length === 0) continue;
    const predicates = batch.map(() => (
      '(platform = ? AND source_account_id = ? AND report_level = ? AND external_entity_id = ? AND metric_date = ?)'
    ));
    const bindings = [customerKey];
    for (const row of batch) {
      bindings.push(row.platform, row.accountId, row.entityType, row.externalEntityId, row.metricDate);
    }
    const result = await db.prepare(`
      SELECT DISTINCT platform, source_account_id, report_level, external_entity_id, metric_date
      FROM ads_daily_facts
      WHERE customer_key = ? AND (${predicates.join(' OR ')})
    `).bind(...bindings).all();
    const rows = Array.isArray(result) ? result : (result?.results ?? []);
    for (const row of rows) {
      verified.add(dailyIdentityKey({
        platform: row.platform,
        accountId: row.source_account_id,
        entityType: row.report_level,
        externalEntityId: row.external_entity_id,
        metricDate: row.metric_date,
      }));
    }
  }
  return verified;
}

async function countLarkRecords(client, tableId) {
  const response = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/tables/${encodeURIComponent(tableId)}/records?page_size=1`,
    { method: 'GET' },
  );
  const total = Number(response?.data?.total);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw maintenanceError(
      'Lark record count response is missing a trustworthy total',
      'MKT_ADS_DAILY_RETENTION_COUNT_UNAVAILABLE',
    );
  }
  return total;
}

async function assertNoActiveSyncLocks(db, now) {
  const result = await db.prepare(
    'SELECT COUNT(*) AS active_locks FROM sync_locks WHERE expires_at > ?',
  ).bind(Number(now)).first();
  if (Number(result?.active_locks ?? 0) > 0) {
    throw maintenanceError(
      'Ads Daily maintenance is blocked by an active sync lock',
      'MKT_ADS_DAILY_RETENTION_ACTIVE_LOCK',
    );
  }
}

function monthToDatePeriod(now, timezone) {
  const parts = dateParts(now, timezone);
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return Object.freeze({
    periodStart: `${parts.year}-${month}-01`,
    periodEnd: `${parts.year}-${month}-${day}`,
  });
}

function calendarMonthPeriods(historyStart, now, timezone) {
  const current = monthToDatePeriod(now, timezone);
  if (historyStart > current.periodEnd) {
    throw new TypeError('historyStart cannot be later than the current local date');
  }
  const [startYear, startMonth] = historyStart.split('-').map(Number);
  const [endYear, endMonth] = current.periodEnd.split('-').map(Number);
  const periods = [];
  for (let year = startYear, month = startMonth;
    year < endYear || (year === endYear && month <= endMonth);
    month += 1) {
    if (month > 12) {
      year += 1;
      month = 1;
    }
    const monthText = String(month).padStart(2, '0');
    const monthStart = `${year}-${monthText}-01`;
    const periodStart = periods.length === 0 ? historyStart : monthStart;
    const periodEnd = year === endYear && month === endMonth
      ? current.periodEnd
      : lastDayOfMonth(year, month);
    periods.push(Object.freeze({ periodStart, periodEnd }));
  }
  return Object.freeze(periods);
}

function lastDayOfMonth(year, month) {
  const date = new Date(Date.UTC(year, month, 0));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function campaignSummaryThaiMonthLabel(periodStart) {
  const [year, month] = periodStart.slice(0, 7).split('-').map(Number);
  const monthNames = [
    'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !monthNames[month - 1]) {
    throw new TypeError('periodStart must contain a valid calendar month');
  }
  return `${monthNames[month - 1]} ${year + 543}`;
}

function dateOnly(value, fieldName) {
  const text = requiredText(value, fieldName);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(text);
  if (!match) throw new TypeError(`${fieldName} must use YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    throw new TypeError(`${fieldName} must be a valid calendar date`);
  }
  return text;
}

function retentionCutoffDate(now, timezone, retentionDays) {
  const current = dateParts(now, timezone);
  const anchor = Date.UTC(current.year, current.month - 1, current.day);
  const cutoff = new Date(anchor - ((retentionDays - 1) * 86_400_000));
  return `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, '0')}-${String(cutoff.getUTCDate()).padStart(2, '0')}`;
}

function dateParts(epoch, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const byType = Object.fromEntries(
    formatter.formatToParts(new Date(epoch)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]),
  );
  const year = Number(byType.year);
  const month = Number(byType.month);
  const day = Number(byType.day);
  if (![year, month, day].every(Number.isSafeInteger)) throw new TypeError(`Invalid timezone: ${timezone}`);
  return { year, month, day };
}

function metricDateFromStableKey(stableKey) {
  if (!stableKey) return null;
  const match = /:(\d{4}-\d{2}-\d{2})$/u.exec(stableKey);
  return match?.[1] ?? null;
}

function dailyIdentityKey(row) {
  return [
    String(row.platform ?? '').toLowerCase(),
    String(row.accountId ?? ''),
    String(row.entityType ?? '').toLowerCase(),
    String(row.externalEntityId ?? ''),
    String(row.metricDate ?? ''),
  ].join('\u0000');
}

function readLarkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return readLarkText(value[0]);
  if (value && typeof value === 'object') return readLarkText(value.text ?? value.name ?? value.value);
  return null;
}

function readLarkEpoch(value) {
  if (Array.isArray(value) && value.length === 1) return readLarkEpoch(value[0]);
  if (value && typeof value === 'object') {
    return readLarkEpoch(value.value ?? value.timestamp ?? value.date ?? null);
  }
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function requireClient(value) {
  if (!value
    || typeof value.requestBitableJson !== 'function'
    || typeof value.searchRecords !== 'function'
    || typeof value.searchRecordsByFieldValues !== 'function'
    || typeof value.batchDeleteRecords !== 'function'
    || !optionalText(value.appToken)) {
    throw new TypeError('Ads maintenance requires a Lark Bitable client');
  }
  return value;
}

function requireDb(value) {
  if (!value || typeof value.prepare !== 'function') throw new TypeError('Ads maintenance requires D1');
  return value;
}

function requireSyncEngine(value) {
  if (!value || typeof value.planByKey !== 'function' || typeof value.executePlan !== 'function') {
    throw new TypeError('Ads maintenance requires syncEngine planByKey/executePlan');
  }
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}

function normalizeNow(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError('now must be a positive timestamp');
  return Math.trunc(number);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = positiveInteger(value, fieldName);
  if (number > maximum) throw new TypeError(`${fieldName} cannot exceed ${maximum}`);
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${fieldName} is required`);
  return text;
}

function maintenanceError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

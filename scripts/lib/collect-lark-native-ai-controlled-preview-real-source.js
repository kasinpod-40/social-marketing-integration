import {
  LARK_NATIVE_AI_CHANNELS,
} from '../../packages/config/src/lark-native-ai-offline-contract.js';
import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION,
} from '../../packages/config/src/lark-native-ai-controlled-preview-exact-terminal-contract.js';
import {
  collectLarkNativeAiSchemaInventory,
} from '../../packages/application/src/reports/collect-lark-native-ai-schema-inventory.js';
import {
  readRawTargetState,
} from '../../packages/application/src/reports/lark-native-ai-schema-apply-model.js';
import {
  buildLarkNativeAiSchemaViewPlans,
} from '../../packages/application/src/reports/lark-native-ai-schema-view-filters.js';
import {
  stableStringify,
} from '../../packages/application/src/use-cases/build-report-snapshot.js';
import {
  exactTerminalError,
  sha256Hex,
} from './lark-native-ai-controlled-preview-exact-terminal.js';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const FIELDS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/fields$/u;
const VIEWS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views$/u;
const VIEW_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/views\/[^/]+$/u;
const RECORD_SEARCH_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/search$/u;
const MAX_REPORT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const EXPECTED_WINDOWS = Object.freeze([1, 3, 7, 30]);
const TIKTOK_SETTING_KEYS = Object.freeze(EXPECTED_WINDOWS.map(
  (windowDays) => `integration_workspace:tiktok:rolling:${windowDays}d`,
));
const SOURCE_STATUS = Object.freeze({
  youtube: 'source_pending',
  instagram: 'source_pending',
  facebook: 'source_pending',
  meta_ads: 'source_pending',
  google_ads: 'source_pending',
  tiktok_ads: 'unavailable',
  woocommerce: 'source_pending',
  chatwoot: 'source_pending',
  operations: 'source_pending',
});

export async function collectLarkNativeAiControlledPreviewRealSource(input = {}) {
  const client = requireClient(input.client);
  const repository = requireObject(input.repository, 'repository');
  const env = requireObject(input.env, 'env');
  const generatedAt = nonNegativeInteger(input.generatedAt ?? Date.now(), 'generatedAt');
  const sourceGuard = input.sourceGuard;
  if (!sourceGuard || typeof sourceGuard.snapshot !== 'function') {
    throw new TypeError('sourceGuard.snapshot is required');
  }

  const schemaAuthority = await collectExactSchemaAuthority(client, generatedAt);
  const tableIds = await resolveReportTableIds(client, env);
  const snapshots = await client.searchRecordsByFieldValues({
    tableId: tableIds.snapshots,
    fieldName: 'report_setting_key',
    values: TIKTOK_SETTING_KEYS,
  });
  const selectedSnapshots = selectExactTikTokSnapshots(snapshots, generatedAt);
  const reportIds = selectedSnapshots.map(({ fields }) => requireText(fields.report_id, 'snapshot.report_id'));
  const metricRecords = await client.searchRecordsByFieldValues({
    tableId: tableIds.metrics,
    fieldName: 'report_id',
    values: reportIds,
  });
  const metricsByReportId = groupMetrics(metricRecords, new Set(reportIds));

  const offlineInputs = selectedSnapshots.map((snapshot) => buildOfflineInput({
    snapshot,
    metricRecords: metricsByReportId.get(snapshot.fields.report_id) ?? [],
    generatedAt,
    repository,
  }));
  const sourceEvidence = {
    repositoryHead: repository.exactHeadSha,
    schemaEvidenceSha256: schemaAuthority.evidenceSha256,
    reportIdentities: selectedSnapshots.map(({ fields }) => ({
      reportId: fields.report_id,
      reportSettingKey: fields.report_setting_key,
      windowDays: Number(fields.window_days),
      generatedAt: Number(fields.generated_at),
      metricCount: (metricsByReportId.get(fields.report_id) ?? []).length,
    })),
    sourceReadCounters: sourceGuard.snapshot(),
  };
  const sourceEvidenceSha256 = await sha256Hex(stableStringify(sourceEvidence));
  const remoteAuthority = await buildSequentialLarkOnlyAuthority({
    env,
    generatedAt,
    repository,
    sourceEvidenceSha256,
  });
  const unsigned = {
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    repositoryHead: repository.exactHeadSha,
    provenance: {
      sourceKind: 'retained_real_validated_report_evidence',
      validationStatus: 'validated',
      frozen: true,
      fixtureData: false,
      sourceEvidenceSha256,
      source: 'live_lark_report_outputs',
      reportPlatform: 'tiktok',
      sourceReadCounters: sourceGuard.snapshot(),
    },
    schemaAuthority,
    remoteAuthority,
    offlineInputs,
  };
  const packageSha256 = await sha256Hex(stableStringify(unsigned));
  return deepFreeze({ ...unsigned, packageSha256 });
}

export function createLarkNativeAiControlledPreviewSourceReadGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    tokenRequestCount: 0,
    tableReadRequestCount: 0,
    fieldReadRequestCount: 0,
    viewListRequestCount: 0,
    viewReadRequestCount: 0,
    recordSearchRequestCount: 0,
    blockedRequestCount: 0,
  };
  const fetchGuarded = async (input, init = {}) => {
    const url = new URL(resolveUrl(input));
    const path = url.pathname;
    const method = String(init?.method ?? requestMethod(input) ?? 'GET').toUpperCase();
    if (method === 'POST' && path === AUTH_PATH) counters.tokenRequestCount += 1;
    else if (method === 'GET' && TABLES_PATH.test(path)) counters.tableReadRequestCount += 1;
    else if (method === 'GET' && FIELDS_PATH.test(path)) counters.fieldReadRequestCount += 1;
    else if (method === 'GET' && VIEWS_PATH.test(path)) counters.viewListRequestCount += 1;
    else if (method === 'GET' && VIEW_PATH.test(path)) counters.viewReadRequestCount += 1;
    else if (method === 'POST' && RECORD_SEARCH_PATH.test(path)) counters.recordSearchRequestCount += 1;
    else {
      counters.blockedRequestCount += 1;
      throw exactTerminalError(
        'Controlled Preview source collector blocked a request outside its read-only allowlist',
        'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_READ_REQUEST_BLOCKED',
        { method, requestClass: classifyPath(path) },
      );
    }
    assertSourceReadBounds(counters);
    return fetchImpl(input, init);
  };
  return Object.freeze({
    fetchImpl: fetchGuarded,
    snapshot: () => deepFreeze({ ...counters, totalRequests: Object.values(counters)
      .reduce((sum, value) => sum + value, 0) }),
  });
}

async function collectExactSchemaAuthority(client, generatedAt) {
  const inventory = await collectLarkNativeAiSchemaInventory({ client });
  if (!inventory.ok
    || inventory.preview?.status !== 'zero_drift'
    || inventory.preview?.actions?.length !== 0
    || inventory.preview?.blockers?.length !== 0) {
    throw exactTerminalError(
      'Current Lark Native AI schema is not zero drift',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_SCHEMA_NOT_ZERO_DRIFT',
      {
        status: inventory.preview?.status ?? null,
        actions: inventory.preview?.actions?.length ?? null,
        blockers: inventory.preview?.blockers ?? [],
      },
    );
  }
  const raw = await readRawTargetState(client);
  const viewPlans = await buildLarkNativeAiSchemaViewPlans(client, raw);
  const incomplete = viewPlans.filter(({ state }) => state !== 'complete');
  if (viewPlans.length !== 6 || incomplete.length !== 0) {
    throw exactTerminalError(
      'Current Lark Native AI Views are not exact 6/6',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_VIEW_FILTER_DRIFT',
      { requiredViewCount: 6, observedViewCount: viewPlans.length, incomplete: incomplete.map(({ viewName, state }) => ({ viewName, state })) },
    );
  }
  const evidenceSha256 = await sha256Hex(stableStringify({
    inventorySha256: inventory.inventory?.sourceSha256,
    views: viewPlans.map(({ viewName, state }) => ({ viewName, state })),
  }));
  return deepFreeze({
    validationStatus: 'validated',
    frozen: true,
    targetTable: '🧠 MKT_AI_Report_Runs',
    status: 'zero_drift',
    requiredViewCount: 6,
    exactViewFilterCount: 6,
    remainingLogicalActionCount: 0,
    evidenceSha256,
    capturedAt: generatedAt,
  });
}

async function resolveReportTableIds(client, env) {
  const snapshots = requireText(env.LARK_TABLE_MKT_REPORT_SNAPSHOTS, 'LARK_TABLE_MKT_REPORT_SNAPSHOTS');
  const metrics = requireText(env.LARK_TABLE_MKT_REPORT_METRIC_VALUES, 'LARK_TABLE_MKT_REPORT_METRIC_VALUES');
  const tables = await client.listTables();
  const remoteIds = new Set(tables.map(({ tableId }) => tableId).filter(Boolean));
  for (const [name, tableId] of Object.entries({ snapshots, metrics })) {
    if (!remoteIds.has(tableId)) throw exactTerminalError(
      `Configured ${name} Table ID is not present in the current Lark Base`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_TABLE_MAPPING_INVALID',
      { table: name },
    );
  }
  return Object.freeze({ snapshots, metrics });
}

function selectExactTikTokSnapshots(records, generatedAt) {
  const normalized = records.map((record) => ({
    recordId: requireText(record.recordId, 'snapshot.recordId'),
    fields: normalizeSnapshotFields(record.fields),
  }));
  const selected = [];
  for (const windowDays of EXPECTED_WINDOWS) {
    const settingKey = `integration_workspace:tiktok:rolling:${windowDays}d`;
    const candidates = normalized.filter(({ fields }) => (
      fields.report_setting_key === settingKey
      && fields.report_type === 'dashboard_performance_report'
      && fields.customer_profile === 'integration_workspace'
      && fields.period_kind === 'rolling_days'
      && Number(fields.window_days) === windowDays
      && normalizePlatforms(fields.platform).includes('tiktok')
    )).sort((left, right) => Number(right.fields.generated_at) - Number(left.fields.generated_at));
    if (candidates.length === 0) throw exactTerminalError(
      `TikTok ${windowDays}D validated Report snapshot is missing`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_TIKTOK_REPORT_MISSING',
      { windowDays },
    );
    const latest = candidates[0];
    const tied = candidates.filter(({ fields }) => Number(fields.generated_at) === Number(latest.fields.generated_at));
    if (tied.length !== 1) throw exactTerminalError(
      `TikTok ${windowDays}D latest Report snapshot is ambiguous`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_TIKTOK_REPORT_AMBIGUOUS',
      { windowDays, candidateCount: tied.length },
    );
    const ageMs = generatedAt - Number(latest.fields.generated_at);
    if (!Number.isSafeInteger(ageMs) || ageMs < 0 || ageMs > MAX_REPORT_AGE_MS) throw exactTerminalError(
      `TikTok ${windowDays}D Report snapshot is outside the seven-day freshness boundary`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_TIKTOK_REPORT_STALE',
      { windowDays, ageMs: Number.isFinite(ageMs) ? ageMs : null },
    );
    selected.push(latest);
  }
  return Object.freeze(selected);
}

function groupMetrics(records, expectedReportIds) {
  const grouped = new Map([...expectedReportIds].map((reportId) => [reportId, []]));
  const identities = new Set();
  for (const record of records) {
    const fields = normalizeMetricFields(record.fields);
    if (!expectedReportIds.has(fields.report_id)) throw exactTerminalError(
      'Metric search returned a Report identity outside the reviewed set',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_IDENTITY_INVALID',
    );
    const identity = requireText(fields.report_metric_key, 'metric.report_metric_key');
    if (identities.has(identity)) throw exactTerminalError(
      'Metric rows contain a duplicate report_metric_key',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_DUPLICATE',
      { reportId: fields.report_id },
    );
    identities.add(identity);
    grouped.get(fields.report_id).push(fields);
  }
  for (const [reportId, metrics] of grouped.entries()) {
    if (metrics.length === 0) throw exactTerminalError(
      'A selected TikTok Report has no Metric rows',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRICS_MISSING',
      { reportId },
    );
    metrics.sort((left, right) => Number(left.rank) - Number(right.rank)
      || left.metric_key.localeCompare(right.metric_key));
  }
  return grouped;
}

function buildOfflineInput({ snapshot, metricRecords, generatedAt, repository }) {
  const fields = snapshot.fields;
  const windowDays = Number(fields.window_days);
  const dataStatus = normalizeDataStatus(fields.data_status);
  const coverageRate = consistentOptionalNumber(metricRecords.map(({ coverage_rate }) => coverage_rate));
  const period = {
    periodKind: 'rolling_days',
    windowDays,
    periodStart: dateOnlyInTimeZone(fields.period_start),
    periodEnd: dateOnlyInTimeZone(fields.period_end),
    comparisonMode: normalizeText(fields.comparison_mode) ?? 'previous_period',
    compareStart: fields.compare_start == null ? null : dateOnlyInTimeZone(fields.compare_start),
    compareEnd: fields.compare_end == null ? null : dateOnlyInTimeZone(fields.compare_end),
  };
  const tiktok = {
    platform: 'tiktok',
    capability: 'organic',
    availabilityStatus: dataStatus === 'complete'
      ? 'complete'
      : (dataStatus === 'no_data_confirmed' ? 'no_data_confirmed' : 'partial'),
    coverageStatus: dataStatus === 'partial' ? 'partial' : 'complete',
    availabilityMessage: `Validated TikTok ${windowDays}D Report output is ${dataStatus}.`,
    report: {
      validationStatus: 'validated',
      frozen: true,
      reportId: fields.report_id,
      reportSettingKey: fields.report_setting_key,
      currency: null,
      payload: {
        schemaVersion: 'report_materialization_v1',
        sourceReportId: fields.report_id,
        platformScope: 'tiktok',
        capability: 'organic',
        reportType: 'dashboard_performance_report',
        period,
        dataStatus,
        coverageRate,
        metricPayload: parseJsonObject(fields.metric_payload_json, 'snapshot.metric_payload_json'),
        collections: {},
        topContent: parseJsonArray(fields.top_content_json, 'snapshot.top_content_json'),
        topAds: parseJsonArray(fields.top_ads_json, 'snapshot.top_ads_json'),
        source: 'validated_lark_report_output',
        sourceWatermark: `lark-report:${fields.report_id}:${fields.generated_at}`,
        generatedAt: Number(fields.generated_at),
        sourceUnavailableReason: null,
        aiSummary: null,
      },
      metricValues: metricRecords.map(toOfflineMetric),
      topContent: parseJsonArray(fields.top_content_json, 'snapshot.top_content_json'),
      topAds: parseJsonArray(fields.top_ads_json, 'snapshot.top_ads_json'),
      commerceRankings: [],
      agentInboxRankings: [],
      warnings: [],
      dataQualityIssues: [],
      freshness: {
        status: 'fresh',
        asOf: Number(fields.generated_at),
        message: 'Validated Lark Report output is within the seven-day exact-terminal freshness boundary.',
      },
    },
  };
  const channels = LARK_NATIVE_AI_CHANNELS.map((channel) => {
    if (channel.platform === 'tiktok') return tiktok;
    return statusChannel(channel, windowDays, generatedAt, repository.exactHeadSha);
  });
  return deepFreeze({
    customer: {
      customerKey: 'integration_workspace',
      displayName: 'Chemistry K Integration Workspace',
      profile: 'integration_workspace',
    },
    window: period,
    generation: {
      generationId: `real-lark-report:${repository.exactHeadSha.slice(0, 12)}:${windowDays}d:${generatedAt}`,
      generatedAt,
      generatorVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
      language: 'th',
      timezone: 'Asia/Bangkok',
    },
    channels,
  });
}

function statusChannel(channel, windowDays, generatedAt, head) {
  const availabilityStatus = SOURCE_STATUS[channel.platform] ?? 'source_pending';
  const reason = availabilityStatus === 'unavailable'
    ? 'The channel source is planned and has no validated aligned Report output.'
    : 'No validated aligned Report output is admitted for this controlled preview.';
  return {
    platform: channel.platform,
    capability: channel.capability,
    availabilityStatus,
    coverageStatus: 'not_applicable',
    availabilityMessage: reason,
    statusEvidence: {
      validationStatus: 'validated',
      frozen: true,
      source: 'shared_report_availability',
      evidenceId: `real-lark-availability:${head.slice(0, 12)}:${channel.platform}:${windowDays}d:${generatedAt}`,
      platform: channel.platform,
      capability: channel.capability,
      availabilityStatus,
      generatedAt,
      freshness: { status: 'fresh', asOf: generatedAt, message: 'Availability was assessed in the current exact-terminal read.' },
      warnings: [],
      dataQualityIssues: [],
    },
  };
}

async function buildSequentialLarkOnlyAuthority({ env, generatedAt, repository, sourceEvidenceSha256 }) {
  const enabledFlags = Object.entries(env)
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && String(value).toLowerCase() === 'true')
    .map(([name]) => name)
    .sort();
  if (enabledFlags.length !== 0) throw exactTerminalError(
    'Exact Terminal requires every local Integration Workspace execution flag to be false',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_LOCAL_FLAGS_NOT_ALL_FALSE',
    { enabledFlags },
  );
  if (env.MKT_ENV !== 'development'
    || env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') {
    throw exactTerminalError(
      'Exact Terminal requires the Integration Workspace development profile',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PROFILE_INVALID',
    );
  }
  const evidenceSha256 = await sha256Hex(stableStringify({
    mode: 'explicit_sequential_lark_only_handoff',
    repositoryHead: repository.exactHeadSha,
    generatedAt,
    sourceEvidenceSha256,
    enabledFlags,
    productionBlocked: true,
    scheduleEnabled: false,
  }));
  return deepFreeze({
    source: 'explicit_sequential_lark_only_handoff',
    validationStatus: 'validated',
    frozen: true,
    evidenceSha256,
    capturedAt: generatedAt,
    metaRemoteLockReleased: true,
    workerFlagsAllFalse: true,
    previewUrlsDisabled: true,
    productionBlocked: true,
    scheduleEnabled: false,
    authorityMode: 'isolated_lark_ai_table_only',
    observedRemoteWorker: false,
    operatorSequentialConfirmation: true,
    mutationSurface: 'lark_mkt_ai_report_runs_records_only',
  });
}

function normalizeSnapshotFields(fieldsInput) {
  const fields = requireObject(fieldsInput, 'snapshot.fields');
  return {
    report_id: larkText(fields.report_id),
    report_setting_key: larkText(fields.report_setting_key),
    customer_profile: larkText(fields.customer_profile),
    account_id: larkText(fields.account_id),
    report_type: larkText(fields.report_type),
    period_kind: larkText(fields.period_kind),
    window_days: larkNumber(fields.window_days),
    period_start: larkNumber(fields.period_start),
    period_end: larkNumber(fields.period_end),
    compare_start: larkNumber(fields.compare_start),
    compare_end: larkNumber(fields.compare_end),
    comparison_mode: larkText(fields.comparison_mode),
    platform: fields.platform,
    metric_payload_json: larkText(fields.metric_payload_json) ?? '{}',
    top_content_json: larkText(fields.top_content_json) ?? '[]',
    top_ads_json: larkText(fields.top_ads_json) ?? '[]',
    generated_at: larkNumber(fields.generated_at),
    data_status: larkText(fields.data_status),
    formula_version: larkText(fields.formula_version),
  };
}

function normalizeMetricFields(fieldsInput) {
  const fields = requireObject(fieldsInput, 'metric.fields');
  return {
    report_metric_key: larkText(fields.report_metric_key),
    report_id: larkText(fields.report_id),
    metric_key: larkText(fields.metric_key),
    display_name: larkText(fields.display_name),
    current_value: larkNumber(fields.current_value),
    compare_value: larkNumber(fields.compare_value),
    change_value: larkNumber(fields.change_value),
    change_percent: larkNumber(fields.change_percent),
    unit: larkText(fields.unit) ?? 'count',
    currency: larkText(fields.currency),
    availability_status: larkText(fields.availability_status) ?? 'not_available',
    availability_message: larkText(fields.availability_message) ?? 'No validated metric value.',
    metric_scope: larkText(fields.metric_scope) ?? 'summary',
    dimension_type: larkText(fields.dimension_type) ?? 'summary',
    dimension_value: larkText(fields.dimension_value) ?? 'all',
    rank: larkNumber(fields.rank) ?? 1,
    coverage_rate: larkNumber(fields.coverage_rate),
  };
}

function toOfflineMetric(metric) {
  return {
    report_id: metric.report_id,
    metric_key: requireText(metric.metric_key, 'metric.metric_key'),
    display_name: requireText(metric.display_name, 'metric.display_name'),
    current_value: metric.current_value,
    compare_value: metric.compare_value,
    change_value: metric.change_value,
    change_percent: metric.change_percent,
    unit: metric.unit,
    currency: metric.currency,
    availability_status: metric.availability_status,
    availability_message: metric.availability_message,
    metric_scope: metric.metric_scope,
    dimension_type: metric.dimension_type,
    dimension_value: metric.dimension_value,
    rank: Number(metric.rank),
    baseline_status: metric.compare_value == null ? 'missing' : 'complete',
    aggregation_method: 'direct_observation',
    ratio_numerator_metric_key: null,
    ratio_denominator_metric_key: null,
    weight_metric_key: null,
    observed: true,
  };
}

function assertSourceReadBounds(counters) {
  if (counters.tokenRequestCount > 2
    || counters.tableReadRequestCount > 2
    || counters.fieldReadRequestCount > 2
    || counters.viewListRequestCount > 2
    || counters.viewReadRequestCount > 6
    || counters.recordSearchRequestCount > 2
    || counters.blockedRequestCount !== 0) {
    counters.blockedRequestCount += 1;
    throw exactTerminalError(
      'Controlled Preview source collector exceeded its reviewed read-only request boundary',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_READ_LIMIT_EXCEEDED',
      { ...counters },
    );
  }
}

function consistentOptionalNumber(values) {
  const finite = [...new Set(values.filter((value) => value != null).map(Number))];
  if (finite.some((value) => !Number.isFinite(value)) || finite.length > 1) throw exactTerminalError(
    'Selected Report Metric rows disagree on coverage_rate',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_COVERAGE_CONFLICT',
  );
  return finite.length === 1 ? finite[0] : null;
}

function normalizeDataStatus(value) {
  const status = requireText(value, 'snapshot.data_status');
  if (status === 'no_data') return 'no_data_confirmed';
  if (!['complete', 'partial', 'no_data_confirmed'].includes(status)) throw exactTerminalError(
    'Selected TikTok Report data_status is unsupported',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_DATA_STATUS_INVALID',
    { status },
  );
  return status;
}

function dateOnlyInTimeZone(value) {
  const epoch = nonNegativeInteger(value, 'date epoch');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epoch));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseJsonObject(value, label) {
  const parsed = parseJson(value, label);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw exactTerminalError(
    `${label} must contain a JSON object`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_REPORT_JSON_INVALID',
    { label },
  );
  return parsed;
}
function parseJsonArray(value, label) {
  const parsed = parseJson(value, label);
  if (!Array.isArray(parsed)) throw exactTerminalError(
    `${label} must contain a JSON array`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_REPORT_JSON_INVALID',
    { label },
  );
  return parsed;
}
function parseJson(value, label) {
  try { return JSON.parse(String(value ?? '')); } catch {
    throw exactTerminalError(
      `${label} is not valid JSON`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_REPORT_JSON_INVALID',
      { label },
    );
  }
}
function normalizePlatforms(value) {
  const items = Array.isArray(value) ? value : [value];
  return items.map(larkText).filter(Boolean).map((item) => item.toLowerCase());
}
function larkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(larkText).filter(Boolean).join('') || null;
  if (value && typeof value === 'object') return larkText(value.text ?? value.value ?? value.name);
  return value == null ? null : String(value).trim() || null;
}
function larkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = scalar && typeof scalar === 'object' ? scalar.value ?? scalar.text : scalar;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}
function normalizeText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function resolveUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input?.url === 'string') return input.url;
  throw new TypeError('Source read guard requires a request URL');
}
function requestMethod(input) { return typeof input?.method === 'string' ? input.method : null; }
function classifyPath(path) {
  if (path.includes('/records')) return 'records';
  if (path.includes('/fields')) return 'fields';
  if (path.includes('/views')) return 'views';
  if (path.includes('/tables')) return 'tables';
  return 'other';
}
function requireClient(value) {
  for (const method of ['listTables', 'listFields', 'listViews', 'getView', 'searchRecordsByFieldValues']) {
    if (typeof value?.[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return value;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw exactTerminalError(
    `${label} is required`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_VALUE_INVALID',
    { label },
  );
  return value.trim();
}
function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw exactTerminalError(
    `${label} must be a non-negative integer`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_VALUE_INVALID',
    { label },
  );
  return number;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}

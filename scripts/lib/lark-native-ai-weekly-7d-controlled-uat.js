import { LARK_NATIVE_AI_CHANNELS } from '../../packages/config/src/lark-native-ai-all-channel-contract.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { stableStringify } from '../../packages/application/src/use-cases/build-report-snapshot.js';
import { weekly7dControlledUatError } from '../../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';

const AUTH_PATH = '/open-apis/auth/v3/tenant_access_token/internal';
const TABLES_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables$/u;
const RECORDS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records$/u;
const RECORD_SEARCH_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/search$/u;
const BATCH_CREATE_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/batch_create$/u;
const BATCH_UPDATE_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/tables\/[^/]+\/records\/batch_update$/u;
const AUTOMATIONS_PATH = /^\/open-apis\/bitable\/v1\/apps\/[^/]+\/workflows$/u;
const INACTIVE_STATUSES = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const REPORT_TYPE = 'dashboard_performance_report';

export async function collectLarkNativeAiWeekly7dControlledUatSource(input = {}) {
  const client = requireClient(input.client);
  const customerProfile = requireText(
    input.customerProfile ?? 'integration_workspace',
    'customerProfile',
  );
  const tables = await resolveTables(client);
  const settingsPage = await client.listRecordsPage({
    tableId: tables.settings,
    pageSize: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumSettingsRows,
    includeRecordMetadata: false,
  });
  if (settingsPage.hasMore) throw sourceError(
    'Report Settings exceeded the bounded weekly UAT inventory',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SETTINGS_LIMIT_EXCEEDED',
  );
  const settings = selectWeeklySettings(settingsPage.records, customerProfile);
  if (settings.length === 0) throw sourceError(
    'No enabled Customer 7D Dashboard Report setting is available',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SETTINGS_MISSING',
  );
  assertUniqueChannelSettings(settings);

  const snapshots = await client.searchRecordsByFieldValues({
    tableId: tables.snapshots,
    fieldName: 'report_setting_key',
    values: settings.map(({ reportSettingKey }) => reportSettingKey),
  });
  if (snapshots.length > LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumSnapshotRows) {
    throw sourceError(
      '7D Snapshot candidates exceeded the bounded weekly UAT inventory',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SNAPSHOT_LIMIT_EXCEEDED',
      { count: snapshots.length },
    );
  }
  const selected = selectTargetSnapshotSet(snapshots, settings, customerProfile);
  const reportIds = selected.map(({ snapshot }) => snapshot.report_id);
  if (reportIds.length === 0) throw sourceError(
    'No validated 7D Report snapshot is available for weekly AI UAT',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_REPORT_MISSING',
  );

  const [metricRecords, topContentRecords, topAdsRecords] = await Promise.all([
    client.searchRecordsByFieldValues({
      tableId: tables.metrics,
      fieldName: 'report_id',
      values: reportIds,
    }),
    client.searchRecordsByFieldValues({
      tableId: tables.topContent,
      fieldName: 'report_id',
      values: reportIds,
    }),
    client.searchRecordsByFieldValues({
      tableId: tables.topAds,
      fieldName: 'report_id',
      values: reportIds,
    }),
  ]);
  enforceRowLimit(metricRecords, 'Metric', LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumMetricRows);
  enforceRowLimit(topContentRecords, 'Top Content', LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumTopContentRows);
  enforceRowLimit(topAdsRecords, 'Top Ads', LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumTopAdsRows);

  const metricsByReport = groupByReport(metricRecords, normalizeMetricFields);
  const topContentByReport = groupByReport(topContentRecords, normalizeTopContentFields);
  const topAdsByReport = groupByReport(topAdsRecords, normalizeTopAdsFields);
  const reportBundles = selected.map(({ setting, snapshot }) => buildReportBundle({
    setting,
    snapshot,
    metrics: metricsByReport.get(snapshot.report_id) ?? [],
    topContent: topContentByReport.get(snapshot.report_id) ?? [],
    topAds: topAdsByReport.get(snapshot.report_id) ?? [],
  }));

  return deepFreeze({
    targetPeriod: selected[0].period,
    settings: settings.map(toBuilderSetting),
    reportBundles,
    selectedChannelCount: selected.length,
    selectedChannels: selected.map(({ setting }) => setting.channelKey).sort(),
    sourceReportIds: [...reportIds].sort(),
    customerProfile,
    tableNames: Object.keys(tables).sort(),
    selectionPolicy: 'newest_7d_period_with_maximum_channel_coverage',
  });
}

export async function assertLarkNativeAiWeekly7dAutomationAuthority(input = {}) {
  const workflows = requireArray(input.workflows, 'workflows');
  const expected = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS;
  const result = [];
  for (const authority of expected) {
    const matches = workflows.filter((item) => larkText(item?.title ?? item?.name) === authority.title);
    if (matches.length !== 1) throw sourceError(
      'Weekly 7D AI UAT requires one exact existing Automation per approved title',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATION_IDENTITY_INVALID',
      { title: authority.title, count: matches.length },
    );
    const workflow = matches[0];
    const workflowId = requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
    if (!/^\d{6,40}$/u.test(workflowId)) throw sourceError(
      'Weekly 7D AI UAT requires the proven Bitable v1 numeric Automation identity',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATION_ID_FORMAT_INVALID',
      { title: authority.title },
    );
    const digest = await sha256Hex(workflowId);
    const status = requireText(workflow.status ?? workflow.state, 'workflow.status').toLowerCase();
    if (digest !== authority.workflowIdSha256 || !INACTIVE_STATUSES.has(status)) throw sourceError(
      'Existing Automation identity or inactive state drifted after the reviewed probe',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATION_AUTHORITY_DRIFT',
      { title: authority.title, status, identityHashMatches: digest === authority.workflowIdSha256 },
    );
    result.push({ title: authority.title, workflowIdSha256: digest, status });
  }
  return deepFreeze(result);
}

export function createLarkNativeAiWeekly7dControlledUatFetchGuard(fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
  const counters = {
    token: 0,
    tableRead: 0,
    recordListRead: 0,
    recordSearchRead: 0,
    automationListRead: 0,
    recordCreateWrite: 0,
    recordUpdateWrite: 0,
    blocked: 0,
  };
  async function guardedFetch(input, init = {}) {
    const url = new URL(resolveUrl(input));
    const path = url.pathname;
    const method = String(init?.method ?? requestMethod(input) ?? 'GET').toUpperCase();
    let kind = null;
    if (method === 'POST' && path === AUTH_PATH) kind = 'token';
    else if (method === 'GET' && TABLES_PATH.test(path)) kind = 'tableRead';
    else if (method === 'GET' && RECORDS_PATH.test(path)) kind = 'recordListRead';
    else if (method === 'POST' && RECORD_SEARCH_PATH.test(path)) kind = 'recordSearchRead';
    else if (method === 'GET' && AUTOMATIONS_PATH.test(path)) kind = 'automationListRead';
    else if (method === 'POST' && BATCH_CREATE_PATH.test(path)) kind = 'recordCreateWrite';
    else if (method === 'POST' && BATCH_UPDATE_PATH.test(path)) kind = 'recordUpdateWrite';
    if (!kind) {
      counters.blocked += 1;
      throw sourceError(
        'Weekly 7D AI UAT blocked a request outside the reviewed Lark-only boundary',
        'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_REQUEST_BLOCKED',
        { method, pathClass: classifyPath(path) },
      );
    }
    counters[kind] += 1;
    assertFetchBounds(counters);
    return fetchImpl(input, init);
  }
  return Object.freeze({
    fetchImpl: guardedFetch,
    snapshot: () => deepFreeze({ ...counters }),
  });
}

function resolveTables(client) {
  return client.listTables().then((inventory) => {
    const resolved = {};
    for (const [key, name] of Object.entries(LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES)) {
      const matches = inventory.filter((table) => table.name === name && table.tableId);
      if (matches.length !== 1) throw sourceError(
        'Weekly 7D AI UAT requires one exact existing Lark table per contract name',
        'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLE_INVALID',
        { key, name, count: matches.length },
      );
      resolved[key] = matches[0].tableId;
    }
    return Object.freeze(resolved);
  });
}

function selectWeeklySettings(records, customerProfile) {
  const output = [];
  for (const record of records) {
    const fields = requireObject(record.fields, 'settings.fields');
    const enabled = larkBoolean(fields.enabled);
    const profile = larkText(fields.customer_profile);
    const reportType = larkText(fields.report_type) ?? REPORT_TYPE;
    const windowDays = Number(larkNumber(fields.window_days));
    if (enabled !== true || profile !== customerProfile || reportType !== REPORT_TYPE || windowDays !== 7) continue;
    const platforms = larkMultiText(fields.platforms ?? fields.platform).map((item) => item.toLowerCase());
    const capability = larkText(fields.capability)?.toLowerCase() ?? null;
    const channel = LARK_NATIVE_AI_CHANNELS.find((item) => (
      platforms.includes(item.platform)
      && (!capability || capability === item.capability)
    ));
    if (!channel) continue;
    output.push(deepFreeze({
      channelKey: channel.channelKey,
      platform: channel.platform,
      capability: channel.capability,
      reportSettingKey: requireText(larkText(fields.report_setting_key), 'settings.report_setting_key'),
      accountId: larkText(fields.account_id),
      enabled: true,
      reportType: REPORT_TYPE,
      windowDays: 7,
    }));
  }
  return deepFreeze(output.sort((a, b) => a.channelKey.localeCompare(b.channelKey)));
}

function assertUniqueChannelSettings(settings) {
  const byChannel = new Map();
  for (const setting of settings) {
    const values = byChannel.get(setting.channelKey) ?? [];
    values.push(setting.reportSettingKey);
    byChannel.set(setting.channelKey, values);
  }
  const duplicates = [...byChannel.entries()].filter(([, values]) => values.length > 1);
  if (duplicates.length > 0) throw sourceError(
    'Weekly 7D AI UAT found duplicate enabled Report settings for a channel',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SETTING_DUPLICATE',
    { channels: duplicates.map(([channelKey]) => channelKey).sort() },
  );
}

function selectTargetSnapshotSet(records, settings, customerProfile) {
  const settingsByKey = new Map(settings.map((setting) => [setting.reportSettingKey, setting]));
  const normalized = records.map((record) => normalizeSnapshotFields(record.fields))
    .filter((snapshot) => (
      settingsByKey.has(snapshot.report_setting_key)
      && snapshot.customer_profile === customerProfile
      && snapshot.report_type === REPORT_TYPE
      && snapshot.window_days === 7
      && snapshot.period_start !== null
      && snapshot.period_end !== null
      && snapshot.generated_at !== null
    ));
  const latestPerSetting = [];
  for (const setting of settings) {
    const candidates = normalized
      .filter((snapshot) => snapshot.report_setting_key === setting.reportSettingKey)
      .sort(compareSnapshotNewest);
    if (candidates.length > 0) latestPerSetting.push({ setting, snapshot: candidates[0] });
  }
  if (latestPerSetting.length === 0) return deepFreeze([]);

  const groups = new Map();
  for (const item of latestPerSetting) {
    const period = snapshotPeriod(item.snapshot);
    const key = stableStringify(period);
    const group = groups.get(key) ?? { period, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort((left, right) => (
    right.items.length - left.items.length
    || right.period.periodEnd.localeCompare(left.period.periodEnd)
    || Math.max(...right.items.map(({ snapshot }) => snapshot.generated_at))
      - Math.max(...left.items.map(({ snapshot }) => snapshot.generated_at))
  ));
  const target = ranked[0];
  const periodKey = stableStringify(target.period);
  const selected = [];
  for (const setting of settings) {
    const candidates = normalized.filter((snapshot) => (
      snapshot.report_setting_key === setting.reportSettingKey
      && stableStringify(snapshotPeriod(snapshot)) === periodKey
    )).sort(compareSnapshotNewest);
    if (candidates.length === 0) continue;
    const latest = candidates[0];
    const ties = candidates.filter((snapshot) => snapshot.generated_at === latest.generated_at);
    if (ties.length > 1) throw sourceError(
      'Latest aligned 7D Report snapshot is ambiguous for one setting',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SNAPSHOT_AMBIGUOUS',
      { channelKey: setting.channelKey, count: ties.length },
    );
    selected.push({ setting, snapshot: latest, period: target.period });
  }
  return deepFreeze(selected.sort((a, b) => a.setting.channelKey.localeCompare(b.setting.channelKey)));
}

function buildReportBundle({ setting, snapshot, metrics, topContent, topAds }) {
  const dataStatus = normalizeDataStatus(snapshot.data_status);
  const coverageRate = snapshot.coverage_rate ?? consistentCoverage(metrics);
  const period = snapshotPeriod(snapshot);
  const collections = buildCollections(metrics);
  const reportId = snapshot.report_id;
  return deepFreeze({
    channelKey: setting.channelKey,
    reportId,
    reportSettingKey: setting.reportSettingKey,
    accountId: snapshot.account_id ?? setting.accountId,
    payload: {
      schemaVersion: 'report_materialization_v1',
      sourceReportId: reportId,
      platformScope: setting.platform,
      capability: setting.capability,
      reportType: REPORT_TYPE,
      period,
      dataStatus,
      coverageRate,
      metricPayload: parseJsonObject(snapshot.metric_payload_json ?? '{}', 'snapshot.metric_payload_json'),
      collections,
      topContent,
      topAds,
      source: 'validated_lark_report_output',
      sourceWatermark: `lark-report:${reportId}:${snapshot.generated_at}`,
      generatedAt: snapshot.generated_at,
      sourceUnavailableReason: ['source_unavailable', 'not_observed'].includes(dataStatus)
        ? 'Validated Report explicitly records unavailable business evidence for this period.'
        : null,
      aiSummary: null,
    },
    metricValues: metrics.map(toBuilderMetric),
    topContent,
    topAds,
  });
}

function buildCollections(metrics) {
  const groups = new Map();
  for (const metric of metrics) {
    if (!metric.dimension_type || metric.dimension_type === 'summary') continue;
    const dimensionType = metric.dimension_type;
    const dimensionValue = metric.dimension_value ?? 'all';
    const key = `${dimensionType}\u0000${dimensionValue}`;
    const item = groups.get(key) ?? {
      dimensionType,
      dimensionValue,
      rank: metric.rank,
      metrics: {},
    };
    item.rank = Math.min(item.rank ?? metric.rank, metric.rank);
    if (metric.availability_status === 'available' && metric.current_value !== null) {
      item.metrics[metric.metric_key] = {
        value: metric.current_value,
        compareValue: metric.compare_value,
        changePercent: metric.change_percent,
        unit: metric.unit,
      };
    }
    groups.set(key, item);
  }
  const byType = {};
  for (const item of groups.values()) {
    const list = byType[item.dimensionType] ?? [];
    list.push(item);
    byType[item.dimensionType] = list;
  }
  for (const list of Object.values(byType)) list.sort((a, b) => a.rank - b.rank || a.dimensionValue.localeCompare(b.dimensionValue));
  return deepFreeze(byType);
}

function groupByReport(records, normalizer) {
  const grouped = new Map();
  for (const record of records) {
    const fields = normalizer(record.fields);
    if (!fields.report_id) continue;
    const list = grouped.get(fields.report_id) ?? [];
    list.push(fields);
    grouped.set(fields.report_id, list);
  }
  for (const list of grouped.values()) list.sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999));
  return grouped;
}

function normalizeSnapshotFields(fieldsInput) {
  const fields = requireObject(fieldsInput, 'snapshot.fields');
  return deepFreeze({
    report_id: requireText(larkText(fields.report_id), 'snapshot.report_id'),
    report_setting_key: requireText(larkText(fields.report_setting_key), 'snapshot.report_setting_key'),
    customer_profile: larkText(fields.customer_profile),
    account_id: larkText(fields.account_id),
    report_type: larkText(fields.report_type),
    window_days: larkNumber(fields.window_days),
    period_start: larkNumber(fields.period_start),
    period_end: larkNumber(fields.period_end),
    compare_start: larkNumber(fields.compare_start),
    compare_end: larkNumber(fields.compare_end),
    comparison_mode: larkText(fields.comparison_mode),
    metric_payload_json: larkText(fields.metric_payload_json) ?? '{}',
    generated_at: larkNumber(fields.generated_at),
    data_status: larkText(fields.data_status),
    coverage_rate: larkNumber(fields.coverage_rate),
  });
}
function normalizeMetricFields(fieldsInput) {
  const fields = requireObject(fieldsInput, 'metric.fields');
  return deepFreeze({
    report_id: larkText(fields.report_id),
    metric_key: requireText(larkText(fields.metric_key), 'metric.metric_key'),
    display_name: larkText(fields.display_name),
    current_value: larkNumber(fields.current_value),
    compare_value: larkNumber(fields.compare_value),
    change_value: larkNumber(fields.change_value),
    change_percent: larkNumber(fields.change_percent),
    unit: larkText(fields.unit) ?? 'count',
    availability_status: larkText(fields.availability_status) ?? 'not_available',
    availability_message: larkText(fields.availability_message),
    metric_scope: larkText(fields.metric_scope) ?? 'summary',
    dimension_type: larkText(fields.dimension_type) ?? 'summary',
    dimension_value: larkText(fields.dimension_value) ?? 'all',
    rank: larkNumber(fields.rank) ?? 1,
    coverage_rate: larkNumber(fields.coverage_rate),
  });
}
function normalizeTopContentFields(fieldsInput) {
  const fields = requireObject(fieldsInput, 'topContent.fields');
  return deepFreeze({
    report_id: larkText(fields.report_id),
    rank: larkNumber(fields.rank) ?? 9999,
    external_content_id: larkText(fields.external_content_id),
    caption: larkText(fields.caption),
    content_url: larkText(fields.content_url),
    published_at: larkNumber(fields.published_at),
    period_views: larkNumber(fields.period_views),
    period_likes: larkNumber(fields.period_likes),
    period_comments: larkNumber(fields.period_comments),
    period_shares: larkNumber(fields.period_shares),
    period_engagement: larkNumber(fields.period_engagement),
    period_engagement_rate: larkNumber(fields.period_engagement_rate),
    latest_total_views: larkNumber(fields.latest_total_views),
    performance_status: larkText(fields.performance_status),
    data_status: larkText(fields.data_status),
  });
}
function normalizeTopAdsFields(fieldsInput) {
  const fields = requireObject(fieldsInput, 'topAds.fields');
  return deepFreeze({
    report_id: larkText(fields.report_id),
    rank: larkNumber(fields.rank) ?? 9999,
    external_ad_id: larkText(fields.external_ad_id),
    external_campaign_id: larkText(fields.external_campaign_id),
    external_ad_group_id: larkText(fields.external_ad_group_id),
    ad_name: larkText(fields.ad_name),
    currency: larkText(fields.currency),
    spend_micros: larkNumber(fields.spend_micros),
    impressions: larkNumber(fields.impressions),
    reach: larkNumber(fields.reach),
    clicks: larkNumber(fields.clicks),
    conversions: larkNumber(fields.conversions),
    conversion_value_micros: larkNumber(fields.conversion_value_micros),
    ctr: larkNumber(fields.ctr),
    cpc_micros: larkNumber(fields.cpc_micros),
    cpa_micros: larkNumber(fields.cpa_micros),
    roas: larkNumber(fields.roas),
    data_status: larkText(fields.data_status),
  });
}

function toBuilderMetric(metric) {
  return deepFreeze({
    report_id: metric.report_id,
    metric_key: metric.metric_key,
    display_name: metric.display_name,
    current_value: metric.current_value,
    compare_value: metric.compare_value,
    change_value: metric.change_value,
    change_percent: metric.change_percent,
    unit: metric.unit,
    availability_status: metric.availability_status,
    availability_message: metric.availability_message,
    metric_scope: metric.metric_scope,
    dimension_type: metric.dimension_type,
    dimension_value: metric.dimension_value,
    rank: metric.rank,
  });
}
function toBuilderSetting(setting) {
  return deepFreeze({
    reportSettingKey: setting.reportSettingKey,
    platforms: [setting.platform],
    reportType: REPORT_TYPE,
    capability: setting.capability,
    windowDays: 7,
    accountId: setting.accountId,
    enabled: true,
  });
}
function snapshotPeriod(snapshot) {
  const comparisonMode = snapshot.comparison_mode ?? 'none';
  const hasComparison = comparisonMode !== 'none' && snapshot.compare_start !== null && snapshot.compare_end !== null;
  return deepFreeze({
    periodKind: 'rolling_days',
    windowDays: 7,
    periodStart: dateOnlyInBangkok(snapshot.period_start),
    periodEnd: dateOnlyInBangkok(snapshot.period_end),
    comparisonMode: hasComparison ? comparisonMode : 'none',
    compareStart: hasComparison ? dateOnlyInBangkok(snapshot.compare_start) : null,
    compareEnd: hasComparison ? dateOnlyInBangkok(snapshot.compare_end) : null,
  });
}
function compareSnapshotNewest(left, right) {
  return right.period_end - left.period_end || right.generated_at - left.generated_at || left.report_id.localeCompare(right.report_id);
}
function normalizeDataStatus(value) {
  const status = requireText(value, 'snapshot.data_status');
  if (status === 'no_data') return 'no_data_confirmed';
  if (!['complete', 'partial', 'revisable', 'no_data_confirmed', 'source_unavailable', 'not_observed'].includes(status)) {
    throw sourceError('Selected 7D Report data_status is unsupported', 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_DATA_STATUS_INVALID', { status });
  }
  return status;
}
function consistentCoverage(metrics) {
  const values = [...new Set(metrics.map(({ coverage_rate }) => coverage_rate).filter((value) => value !== null))];
  if (values.length > 1) throw sourceError('Selected Report metrics disagree on coverage_rate', 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_COVERAGE_CONFLICT');
  return values[0] ?? null;
}
function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw sourceError(`${label} is not valid object JSON`, 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_REPORT_JSON_INVALID', { label });
  }
}
function enforceRowLimit(records, label, maximum) { if (records.length > maximum) throw sourceError(`${label} rows exceed controlled UAT limit`, 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_ROW_LIMIT_EXCEEDED', { label, count: records.length, maximum }); }
function assertFetchBounds(counters) {
  const writes = counters.recordCreateWrite + counters.recordUpdateWrite;
  if (counters.token > 2
    || counters.tableRead > 1
    || counters.recordListRead > 1
    || counters.recordSearchRead > 6
    || counters.automationListRead > LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumAutomationListReads
    || writes > LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LIMITS.maximumRecordWrites
    || counters.blocked !== 0) {
    counters.blocked += 1;
    throw sourceError('Weekly 7D AI UAT exceeded its reviewed request boundary', 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_REQUEST_LIMIT_EXCEEDED', { ...counters });
  }
}
function dateOnlyInBangkok(value) {
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) throw new TypeError('date epoch is required');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epoch));
  const byType = Object.fromEntries(parts.map(({ type, value: partValue }) => [type, partValue]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
function larkMultiText(value) {
  if (Array.isArray(value)) return value.map(larkText).filter(Boolean);
  const text = larkText(value);
  return text ? [text] : [];
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
function larkBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = larkText(value)?.toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no' || text === null) return false;
  return Boolean(value);
}
function classifyPath(path) { if (path.includes('/workflows')) return 'automation'; if (path.includes('/records')) return 'records'; if (path.includes('/tables')) return 'tables'; return 'other'; }
function resolveUrl(input) { if (typeof input === 'string') return input; if (input instanceof URL) return input.href; if (typeof input?.url === 'string') return input.url; throw new TypeError('Request URL is required'); }
function requestMethod(input) { return typeof input?.method === 'string' ? input.method : null; }
function requireClient(value) { for (const method of ['listTables', 'listRecordsPage', 'searchRecordsByFieldValues']) if (typeof value?.[method] !== 'function') throw new TypeError(`client.${method} is required`); return value; }
function requireArray(value, label) { if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`); return value; }
function requireObject(value, label) { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`); return value; }
function requireText(value, label) { if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`); return value.trim(); }
async function sha256Hex(value) { const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value))); return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function sourceError(message, code, details = {}) { return weekly7dControlledUatError(message, code, details); }
function deepFreeze(value, seen = new WeakSet()) { if (value && typeof value === 'object') { if (seen.has(value)) return value; seen.add(value); for (const nested of Object.values(value)) deepFreeze(nested, seen); Object.freeze(value); } return value; }

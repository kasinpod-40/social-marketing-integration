export const INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION = 'RUN_INSTAGRAM_GOOGLE_ADS_READINESS_AUDIT';
export const INSTAGRAM_GOOGLE_ADS_CHANNELS = Object.freeze(['instagram_organic', 'google_ads']);
export const INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS = Object.freeze([1, 3, 7, 30]);

const EXPECTED_TARGET = Object.freeze({
  environment: 'development',
  customerProfile: 'integration_workspace',
  accountKey: 'chemistry_k',
});

export function parseInstagramGoogleAdsReadinessArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw auditError(
    `Unsupported Instagram/Google Ads readiness arguments: ${unknown.join(', ')}`,
    'INSTAGRAM_GOOGLE_ADS_READINESS_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertInstagramGoogleAdsReadinessConfirmation(env = {}) {
  if (env.CONFIRM_INSTAGRAM_GOOGLE_ADS_READINESS_AUDIT !== INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION) {
    throw auditError(
      `Execution requires CONFIRM_INSTAGRAM_GOOGLE_ADS_READINESS_AUDIT=${INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION}`,
      'INSTAGRAM_GOOGLE_ADS_READINESS_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assessInstagramGoogleAdsReadiness(input = {}) {
  const target = requireObject(input.target, 'target');
  assertExactTarget(target);
  const runtime = requireObject(input.runtime, 'runtime');
  const channels = requireObject(input.channels, 'channels');
  const runtimeBlockers = assessRuntime(runtime);

  const instagram = assessChannel({
    channel: 'instagram_organic',
    input: requireObject(channels.instagram_organic, 'channels.instagram_organic'),
    runtimeBlockers,
  });
  const googleAds = assessChannel({
    channel: 'google_ads',
    input: requireObject(channels.google_ads, 'channels.google_ads'),
    runtimeBlockers,
  });

  return Object.freeze({
    contractVersion: 'instagram_google_ads_report_readiness_audit_v1',
    target: Object.freeze({ ...EXPECTED_TARGET }),
    channels: Object.freeze({
      instagram_organic: instagram,
      google_ads: googleAds,
    }),
    promotionReadyCount: [instagram, googleAds].filter((entry) => entry.promotionReady).length,
    independentDecisions: true,
    remoteMutationCount: 0,
    providerRequestCount: 0,
    signedDeliveryReplayCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    production: 'BLOCKED',
  });
}

function assessRuntime(runtime) {
  const blockers = [];
  if (runtime.allExecutionFlagsFalse !== true) blockers.push(blocker('worker_flags_not_safe', 'runtime'));
  if (runtime.bindingsMatch !== true) blockers.push(blocker('runtime_binding_drift', 'runtime'));
  if (Number(runtime.activeTrafficPercent) !== 100) blockers.push(blocker(
    'worker_traffic_not_100_percent',
    'runtime',
    { activeTrafficPercent: finiteOrNull(runtime.activeTrafficPercent) },
  ));
  for (const [field, code] of [
    ['pendingMigrationCount', 'pending_migration'],
    ['activeTargetWorkCount', 'active_work_or_lock'],
    ['activeTargetLockCount', 'active_work_or_lock'],
  ]) {
    const count = nonNegativeInteger(runtime[field], `runtime.${field}`);
    if (count !== 0) blockers.push(blocker(code, 'runtime', { field, count }));
  }
  return Object.freeze(blockers);
}

function assessChannel({ channel, input, runtimeBlockers }) {
  const blockers = [...runtimeBlockers];
  const catalog = requireObject(input.catalog, `${channel}.catalog`);
  const source = requireObject(input.source, `${channel}.source`);
  const report = requireObject(input.report, `${channel}.report`);
  const incidents = requireObject(input.incidents, `${channel}.incidents`);

  collectCatalogState(channel, catalog, blockers);
  collectSourceState(channel, source, blockers);
  collectReportState(channel, report, blockers);
  collectIncidentState(channel, incidents, blockers);

  const promotionReady = blockers.length === 0;
  return Object.freeze({
    channel,
    promotionReady,
    currentCatalogStatus: Object.freeze({
      connector: catalog.connectorStatus ?? null,
      job: catalog.jobStatus ?? null,
      report: catalog.reportStatus ?? null,
    }),
    nextGate: promotionReady ? 'catalog_promotion_ready' : nextGate(blockers),
    blockers: Object.freeze(blockers),
    windows: Object.freeze(INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS.map((windowDays) => Object.freeze({
      windowDays,
      previewReady: report.previewWindows?.includes(windowDays) === true,
    }))),
  });
}

function collectCatalogState(channel, catalog, blockers) {
  for (const field of ['connectorStatus', 'jobStatus', 'reportStatus']) {
    if (catalog[field] !== 'uat_pending') blockers.push(blocker(
      'catalog_status_unexpected',
      'catalog',
      { channel, field, expected: 'uat_pending', observed: catalog[field] ?? null },
    ));
  }
  if (catalog.adapterRegistered !== true) blockers.push(blocker('report_contract_missing', 'catalog', { channel }));
  if (catalog.readerRegistered !== true) blockers.push(blocker('source_reader_missing', 'catalog', { channel }));
}

function collectSourceState(channel, source, blockers) {
  if (source.identityAccepted !== true) blockers.push(blocker('provider_identity_pending', 'source', { channel }));
  if (source.sourceUatComplete !== true) blockers.push(blocker('source_uat_pending', 'source', { channel }));
  if (source.coverageComplete !== true || nonNegativeInteger(source.coverageFailureCount, `${channel}.coverageFailureCount`) !== 0) {
    blockers.push(blocker('coverage_incomplete', 'source', { channel }));
  }
  if (source.factsPresent !== true) blockers.push(blocker('source_facts_missing', 'source', { channel }));
  if (source.larkParityComplete !== true) blockers.push(blocker('source_lark_parity_pending', 'source', { channel }));
  if (source.dateRangeSufficient !== true) blockers.push(blocker('baseline_incomplete', 'source', { channel }));

  if (channel === 'instagram_organic' && source.metaContinuationComplete !== true) {
    blockers.push(blocker('meta_continuation_pending', 'source', { channel }));
  }
  if (channel === 'google_ads') {
    if (source.signedDeliveryComplete !== true) blockers.push(blocker('signed_delivery_pending', 'source', { channel }));
    if (source.deliveryReplayVerified !== true) blockers.push(blocker('delivery_idempotency_pending', 'source', { channel }));
    if (source.currencyTimezoneConsistent !== true) blockers.push(blocker('currency_timezone_drift', 'source', { channel }));
    if (source.adsEntityCount === undefined || nonNegativeInteger(source.adsEntityCount, 'google_ads.adsEntityCount') === 0) {
      blockers.push(blocker('source_facts_missing', 'source', { channel, fact: 'ads_entities' }));
    }
    if (source.adsDailyCount === undefined || nonNegativeInteger(source.adsDailyCount, 'google_ads.adsDailyCount') === 0) {
      blockers.push(blocker('source_facts_missing', 'source', { channel, fact: 'ads_daily' }));
    }
  }
}

function collectReportState(channel, report, blockers) {
  if (report.settingsReady !== true) blockers.push(blocker('report_settings_missing', 'report', { channel }));
  if (report.materializerCompatible !== true) blockers.push(blocker('report_contract_missing', 'report', { channel }));
  if (report.larkWriterCompatible !== true) blockers.push(blocker('report_lark_contract_missing', 'report', { channel }));
  const previewWindows = Array.isArray(report.previewWindows) ? report.previewWindows.map(Number) : [];
  if (JSON.stringify(previewWindows) !== JSON.stringify(INSTAGRAM_GOOGLE_ADS_REPORT_WINDOWS)) blockers.push(blocker(
    'report_preview_incomplete',
    'report',
    { channel, observed: previewWindows },
  ));
  if (report.nullZeroSemanticsVerified !== true) blockers.push(blocker('report_null_zero_contract_pending', 'report', { channel }));
  if (channel === 'google_ads' && report.sumBeforeRatioVerified !== true) {
    blockers.push(blocker('ads_sum_before_ratio_pending', 'report', { channel }));
  }
}

function collectIncidentState(channel, incidents, blockers) {
  const openDlqCount = nonNegativeInteger(incidents.openTerminalDlqCount, `${channel}.openTerminalDlqCount`);
  const openAlertCount = nonNegativeInteger(incidents.openCriticalAlertCount, `${channel}.openCriticalAlertCount`);
  if (openDlqCount !== 0 || openAlertCount !== 0) blockers.push(blocker(
    'terminal_incident_open',
    'incident',
    { channel, openDlqCount, openAlertCount },
  ));
}

function nextGate(blockers) {
  const priority = [
    'active_work_or_lock',
    'terminal_incident_open',
    'meta_continuation_pending',
    'provider_identity_pending',
    'signed_delivery_pending',
    'source_uat_pending',
    'coverage_incomplete',
    'source_facts_missing',
    'source_lark_parity_pending',
    'report_contract_missing',
    'report_settings_missing',
    'baseline_incomplete',
  ];
  return priority.find((code) => blockers.some((entry) => entry.code === code)) ?? blockers[0]?.code ?? 'catalog_promotion_ready';
}

function assertExactTarget(target) {
  for (const [field, expected] of Object.entries(EXPECTED_TARGET)) {
    if (target[field] !== expected) throw auditError(
      `Instagram/Google Ads readiness target ${field} must equal ${expected}`,
      'INSTAGRAM_GOOGLE_ADS_READINESS_TARGET_INVALID',
      { field, expected, observed: target[field] ?? null },
    );
  }
}

function blocker(code, scope, details = {}) {
  return Object.freeze({ code, scope, details: Object.freeze({ ...details }) });
}

function nonNegativeInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw auditError(
    `${field} must be a non-negative integer`,
    'INSTAGRAM_GOOGLE_ADS_READINESS_COUNT_INVALID',
    { field },
  );
  return number;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw auditError(
    `${field} must be an object`,
    'INSTAGRAM_GOOGLE_ADS_READINESS_INPUT_INVALID',
    { field },
  );
  return value;
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'InstagramGoogleAdsReadinessAuditError';
  error.code = code;
  error.details = details;
  return error;
}

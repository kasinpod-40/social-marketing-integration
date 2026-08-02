export const INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION =
  'RUN_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR';
export const INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF =
  'INSTAGRAM_GOOGLE_ADS_REMOTE_REVIEWED_HANDOFF_V1';

export function parseInstagramGoogleAdsRemoteCollectorArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw collectorError(
    `Unsupported Instagram/Google Ads remote collector arguments: ${unknown.join(', ')}`,
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertInstagramGoogleAdsRemoteCollectorConfirmation(env = {}) {
  if (env.CONFIRM_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR
    !== INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION) {
    throw collectorError(
      `Execution requires CONFIRM_INSTAGRAM_GOOGLE_ADS_REMOTE_READINESS_COLLECTOR=${INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION}`,
      'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_CONFIRMATION_REQUIRED',
    );
  }
  if (env.MKT_INSTAGRAM_GOOGLE_ADS_REMOTE_INTERNAL_HANDOFF
    !== INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF) {
    throw collectorError(
      'Direct execution is blocked; use the reviewed Instagram/Google Ads Remote readiness terminal',
      'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INTERNAL_HANDOFF_REQUIRED',
    );
  }
  return true;
}

export function assertIndependentSelectOnlySql(sql) {
  const text = requireText(sql, 'sql').trim();
  if (!/^(SELECT|WITH)\b/iu.test(text)
    || /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|VACUUM|ATTACH|DETACH)\b/iu.test(text)) {
    throw collectorError(
      'Instagram/Google Ads collector permits SELECT/WITH statements only',
      'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_NON_SELECT_BLOCKED',
    );
  }
  return text;
}

export function parseRemoteJson(value) {
  const text = String(value ?? '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  throw collectorError(
    'Remote command output did not contain valid JSON',
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_JSON_INVALID',
  );
}

export function unwrapRemoteRows(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => entry?.results ?? []);
  return Array.isArray(value?.results) ? value.results : [];
}

export function buildInstagramGoogleAdsRemoteEvidence(input = {}) {
  const runtime = requireObject(input.runtime, 'runtime');
  const instagram = buildChannel('instagram_organic', requireObject(input.instagram, 'instagram'));
  const googleAds = buildChannel('google_ads', requireObject(input.googleAds, 'googleAds'));
  return Object.freeze({
    target: Object.freeze({
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
    }),
    runtime: Object.freeze({
      allExecutionFlagsFalse: Array.isArray(runtime.trueFlags) && runtime.trueFlags.length === 0,
      bindingsMatch: runtime.bindingsMatch === true,
      activeTrafficPercent: finiteOrZero(runtime.activeTrafficPercent),
      pendingMigrationCount: nonNegativeInteger(runtime.pendingMigrationCount, 'pendingMigrationCount'),
      activeTargetWorkCount: nonNegativeInteger(runtime.activeTargetWorkCount, 'activeTargetWorkCount'),
      activeTargetLockCount: nonNegativeInteger(runtime.activeTargetLockCount, 'activeTargetLockCount'),
    }),
    channels: Object.freeze({
      instagram_organic: instagram,
      google_ads: googleAds,
    }),
  });
}

export function buildFailedChannelEvidence(channel, reasonCode) {
  const googleAds = channel === 'google_ads';
  return Object.freeze({
    catalog: Object.freeze({
      connectorStatus: 'uat_pending',
      jobStatus: 'uat_pending',
      reportStatus: 'uat_pending',
      adapterRegistered: true,
      readerRegistered: true,
    }),
    source: Object.freeze({
      identityAccepted: false,
      sourceUatComplete: false,
      coverageComplete: false,
      coverageFailureCount: 1,
      factsPresent: false,
      larkParityComplete: false,
      dateRangeSufficient: false,
      ...(channel === 'instagram_organic' ? { metaContinuationComplete: false } : {}),
      ...(googleAds ? {
        signedDeliveryComplete: false,
        deliveryReplayVerified: false,
        currencyTimezoneConsistent: false,
        adsEntityCount: 0,
        adsDailyCount: 0,
      } : {}),
      collectionFailureCode: requireText(reasonCode, 'reasonCode'),
    }),
    report: Object.freeze({
      settingsReady: false,
      materializerCompatible: false,
      larkWriterCompatible: false,
      previewWindows: Object.freeze([]),
      nullZeroSemanticsVerified: false,
      ...(googleAds ? { sumBeforeRatioVerified: false } : {}),
    }),
    incidents: Object.freeze({ openTerminalDlqCount: 1, openCriticalAlertCount: 1 }),
  });
}

export function sanitizeIndependentRemoteEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeIndependentRemoteEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|table.?id|database.?id|queue.?id|version.?id|uuid|raw|external.?account)/iu.test(key))
    .map(([key, entry]) => [key, sanitizeIndependentRemoteEvidence(entry)])));
}

function buildChannel(channel, input) {
  const googleAds = channel === 'google_ads';
  const source = requireObject(input.source, `${channel}.source`);
  const report = requireObject(input.report, `${channel}.report`);
  const incidents = requireObject(input.incidents, `${channel}.incidents`);
  return Object.freeze({
    catalog: Object.freeze({
      connectorStatus: optionalText(input.catalog?.connectorStatus),
      jobStatus: optionalText(input.catalog?.jobStatus),
      reportStatus: optionalText(input.catalog?.reportStatus),
      adapterRegistered: input.catalog?.adapterRegistered === true,
      readerRegistered: input.catalog?.readerRegistered === true,
    }),
    source: Object.freeze({
      identityAccepted: source.identityAccepted === true,
      sourceUatComplete: source.sourceUatComplete === true,
      coverageComplete: source.coverageComplete === true,
      coverageFailureCount: nonNegativeInteger(source.coverageFailureCount, `${channel}.coverageFailureCount`),
      factsPresent: source.factsPresent === true,
      larkParityComplete: source.larkParityComplete === true,
      dateRangeSufficient: source.dateRangeSufficient === true,
      ...(channel === 'instagram_organic'
        ? { metaContinuationComplete: source.metaContinuationComplete === true }
        : {}),
      ...(googleAds ? {
        signedDeliveryComplete: source.signedDeliveryComplete === true,
        deliveryReplayVerified: source.deliveryReplayVerified === true,
        currencyTimezoneConsistent: source.currencyTimezoneConsistent === true,
        adsEntityCount: nonNegativeInteger(source.adsEntityCount, 'google_ads.adsEntityCount'),
        adsDailyCount: nonNegativeInteger(source.adsDailyCount, 'google_ads.adsDailyCount'),
      } : {}),
    }),
    report: Object.freeze({
      settingsReady: report.settingsReady === true,
      materializerCompatible: report.materializerCompatible === true,
      larkWriterCompatible: report.larkWriterCompatible === true,
      previewWindows: Object.freeze(requireArray(report.previewWindows, `${channel}.previewWindows`).map(Number)),
      nullZeroSemanticsVerified: report.nullZeroSemanticsVerified === true,
      ...(googleAds ? { sumBeforeRatioVerified: report.sumBeforeRatioVerified === true } : {}),
    }),
    incidents: Object.freeze({
      openTerminalDlqCount: nonNegativeInteger(incidents.openTerminalDlqCount, `${channel}.openTerminalDlqCount`),
      openCriticalAlertCount: nonNegativeInteger(incidents.openCriticalAlertCount, `${channel}.openCriticalAlertCount`),
    }),
  });
}

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw collectorError(
    `${fieldName} must be a non-negative integer`,
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_COUNT_INVALID',
    { fieldName },
  );
  return number;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw collectorError(
    `${fieldName} is required`,
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INPUT_INVALID',
    { fieldName },
  );
  return value.trim();
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw collectorError(
    `${fieldName} must be an object`,
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INPUT_INVALID',
    { fieldName },
  );
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw collectorError(
    `${fieldName} must be an array`,
    'INSTAGRAM_GOOGLE_ADS_REMOTE_COLLECTOR_INPUT_INVALID',
    { fieldName },
  );
  return value;
}
function collectorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'InstagramGoogleAdsRemoteReadinessCollectorError';
  error.code = code;
  error.details = details;
  return error;
}

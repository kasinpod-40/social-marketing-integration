export const CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION =
  'RUN_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR';
export const CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF =
  'CHATWOOT_REPORT_REMOTE_REVIEWED_HANDOFF_V1';

export function parseChatwootReportRemoteCollectorArgs(argv = []) {
  const allowed = new Set(['--execute']);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) throw collectorError(
    `Unsupported Chatwoot Report remote collector arguments: ${unknown.join(', ')}`,
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_ARGUMENT_INVALID',
    { arguments: unknown },
  );
  return Object.freeze({ execute: argv.includes('--execute') });
}

export function assertChatwootReportRemoteCollectorConfirmation(env = {}) {
  if (env.CONFIRM_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR
    !== CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION) {
    throw collectorError(
      `Execution requires CONFIRM_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR=${CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION}`,
      'CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION_REQUIRED',
    );
  }
  if (env.MKT_CHATWOOT_REPORT_REMOTE_INTERNAL_HANDOFF
    !== CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF) {
    throw collectorError(
      'Direct execution is blocked; use the reviewed Chatwoot Report readiness terminal',
      'CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF_REQUIRED',
    );
  }
  return true;
}

export function assertChatwootSelectOnlySql(sql) {
  const text = requireText(sql, 'sql').trim();
  if (!/^(SELECT|WITH)\b/iu.test(text)
    || /\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|VACUUM|ATTACH|DETACH)\b/iu.test(text)) {
    throw collectorError(
      'Chatwoot Report remote collector permits SELECT/WITH statements only',
      'CHATWOOT_REPORT_REMOTE_COLLECTOR_NON_SELECT_BLOCKED',
    );
  }
  return text;
}

export function parseChatwootRemoteJson(value) {
  const text = String(value ?? '').trim();
  const starts = [text.indexOf('{'), text.indexOf('[')]
    .filter((index) => index >= 0)
    .sort((left, right) => left - right);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  throw collectorError(
    'Remote command output did not contain valid JSON',
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_JSON_INVALID',
  );
}

export function unwrapChatwootRemoteRows(value) {
  if (Array.isArray(value)) return value.flatMap((entry) => entry?.results ?? []);
  return Array.isArray(value?.results) ? value.results : [];
}

export function buildChatwootReportRemoteEvidence(input = {}) {
  return Object.freeze({
    target: Object.freeze({
      environment: 'development',
      customerProfile: 'integration_workspace',
      accountKey: 'chemistry_k',
      platformScope: 'chatwoot',
    }),
    runtime: freezeObject(input.runtime, 'runtime'),
    catalog: freezeObject(input.catalog, 'catalog'),
    source: freezeObject(input.source, 'source'),
    report: freezeObject(input.report, 'report'),
    incidents: freezeObject(input.incidents, 'incidents'),
    windows: Object.freeze(requireArray(input.windows, 'windows').map((entry) => Object.freeze({ ...entry }))),
  });
}

export function sanitizeChatwootRemoteEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeChatwootRemoteEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.freeze(Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|cookie|password|table.?id|database.?id|queue.?id|version.?id|uuid|raw|external.?account)/iu.test(key))
    .map(([key, entry]) => [key, sanitizeChatwootRemoteEvidence(entry)])));
}

function freezeObject(value, field) {
  const object = requireObject(value, field);
  return Object.freeze({ ...object });
}
function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw collectorError(
    `${field} is required`,
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_INPUT_INVALID',
    { field },
  );
  return value.trim();
}
function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw collectorError(
    `${field} must be an object`,
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_INPUT_INVALID',
    { field },
  );
  return value;
}
function requireArray(value, field) {
  if (!Array.isArray(value)) throw collectorError(
    `${field} must be an array`,
    'CHATWOOT_REPORT_REMOTE_COLLECTOR_INPUT_INVALID',
    { field },
  );
  return value;
}
function collectorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootReportRemoteReadinessCollectorError';
  error.code = code;
  error.details = details;
  return error;
}

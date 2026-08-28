import { createHash } from 'node:crypto';

import { processMetaEndToEndSync } from '../../packages/application/src/use-cases/process-meta-end-to-end-sync.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const LOCAL_WRITE_SENTINEL = 'META_K2_DIAGNOSTIC_LOCAL_WRITE_SENTINEL';
const SAFE_DETAIL_FIELDS = new Set([
  'connectorKey',
  'datasetKey',
  'expected',
  'expectedUnits',
  'field',
  'fieldName',
  'maximum',
  'maximumDays',
  'observed',
  'observedUnits',
  'stage',
]);

export function summarizeMetaK2StagedUnits(payloads = []) {
  if (!Array.isArray(payloads)) {
    throw auditError(
      'Meta K2 staged payloads must be an array',
      'META_K2_FAILURE_AUDIT_PAYLOAD_INVALID',
    );
  }
  const datasets = new Map();
  let rowCount = 0;
  for (const raw of payloads) {
    const payload = requireObject(raw, 'staged payload');
    const datasetKey = requireText(payload.datasetKey, 'staged payload datasetKey');
    const rows = requireArray(payload.rows, 'staged payload rows');
    const current = datasets.get(datasetKey) ?? { unitCount: 0, rowCount: 0 };
    current.unitCount += 1;
    current.rowCount += rows.length;
    datasets.set(datasetKey, current);
    rowCount += rows.length;
  }
  return deepFreeze({
    unitCount: payloads.length,
    rowCount,
    datasets: [...datasets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([datasetKey, counts]) => Object.freeze({ datasetKey, ...counts })),
  });
}

export function describeMetaK2PersistedError(row = {}) {
  const source = requireObject(row, 'sync run row');
  const descriptor = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === null || value === undefined || value === '') continue;
    if (!/error|message|detail|cause/iu.test(key)) continue;
    descriptor[key] = describeErrorValue(value, key);
  }
  return deepFreeze({
    fields: Object.keys(descriptor).sort(),
    descriptor,
    fingerprint: sha256(stableJson(descriptor)),
  });
}

export async function replayMetaK2SourceCompleteValidation(input = {}) {
  const payloads = requireArray(input.payloads, 'payloads');
  const sourceState = requireObject(input.sourceState, 'sourceState');
  const identity = requireObject(input.identity, 'identity');
  const generation = requireTimestamp(input.generation, 'generation');
  const originalRequestedAt = requireTimestamp(
    input.originalRequestedAt,
    'originalRequestedAt',
  );
  const sourceAccountId = deriveSourceAccountId(payloads);
  let providerRequestCount = 0;
  let localWriteSentinelCount = 0;

  const sentinel = (boundary) => {
    localWriteSentinelCount += 1;
    const error = new Error('Meta K2 diagnostic reached the local write boundary');
    error.code = LOCAL_WRITE_SENTINEL;
    error.details = { boundary };
    throw error;
  };
  const workStore = {
    async beginWork() {
      return { superseded: false, completed: false };
    },
    async loadPhase({ phase }) {
      if (phase === SOURCE_PHASE) return { complete: true, state: sourceState };
      return null;
    },
    async listPhaseUnits() {
      return {
        units: payloads.map((payload, sequence) => ({ sequence, payload })),
      };
    },
    async savePhase({ phase }) {
      return sentinel(`workStore.savePhase:${phase}`);
    },
    async completeWork() {
      return sentinel('workStore.completeWork');
    },
  };
  const historyStore = Object.fromEntries([
    'upsertOrganicAccountDailyFact',
    'upsertAdsEntityState',
    'upsertAdsDailyFact',
    'saveCoverageRun',
    'saveCoverageEntities',
  ].map((method) => [method, async () => sentinel(`historyStore.${method}`)]));
  const adapter = new Proxy({}, {
    get() {
      providerRequestCount += 1;
      throw auditError(
        'Meta K2 diagnostic attempted a Provider read after source completion',
        'META_K2_FAILURE_AUDIT_PROVIDER_READ_ATTEMPTED',
      );
    },
  });
  const syncEngine = {
    async planByKey() {
      return sentinel('syncEngine.planByKey');
    },
    async executePlan() {
      return sentinel('syncEngine.executePlan');
    },
  };

  try {
    const result = await processMetaEndToEndSync({
      connectorKey: identity.connectorKey,
      operation: {
        stable: true,
        operationId: identity.operationId,
        workKey: identity.workKey,
        generation,
        originalRequestedAt,
      },
      resumableWorkStore: workStore,
      adapter,
      sourceAccountId,
      accountKey: identity.accountKey,
      customerProfile: identity.customerProfile,
      customerKey: identity.customerKey,
      syncRunId: identity.syncRunId,
      sourceTimezone: 'Asia/Bangkok',
      dateRange: {
        since: identity.periodStart,
        until: identity.periodEnd,
      },
      limits: {
        sourceMaxPages: 100,
        sourceMaxUnits: 500,
        sourceMaxRows: 50_000,
        sourceMaxUnitBytes: 1_048_576,
        d1RowsPerInvocation: 250,
        larkTablesPerInvocation: 1,
      },
      d1WriteEnabled: true,
      larkWriteEnabled: false,
      postSourceMaterializationEnabled: false,
      historyStore,
      repository: {},
      syncEngine,
      tables: {},
      assertLockActive: async () => undefined,
    });
    return deepFreeze({
      sourceAssemblyAccepted: true,
      writeSetAccepted: true,
      unexpectedTerminalResult: result?.status ?? null,
      replayError: null,
      providerRequestCount,
      localWriteSentinelCount,
      remoteMutationCount: 0,
    });
  } catch (error) {
    if (error?.code === LOCAL_WRITE_SENTINEL) {
      return deepFreeze({
        sourceAssemblyAccepted: true,
        writeSetAccepted: true,
        unexpectedTerminalResult: null,
        replayError: null,
        providerRequestCount,
        localWriteSentinelCount,
        remoteMutationCount: 0,
      });
    }
    return deepFreeze({
      sourceAssemblyAccepted: false,
      writeSetAccepted: false,
      unexpectedTerminalResult: null,
      replayError: describeReplayError(error),
      providerRequestCount,
      localWriteSentinelCount,
      remoteMutationCount: 0,
    });
  }
}

export async function replayMetaK2CompleteLarkPayloadPreflight(input = {}) {
  const payloads = requireArray(input.payloads, 'payloads');
  const sourceState = requireObject(input.sourceState, 'sourceState');
  const identity = requireObject(input.identity, 'identity');
  const repository = requireObject(input.repository, 'repository');
  const tables = requireObject(input.tables, 'tables');
  const generation = requireTimestamp(input.generation, 'generation');
  const originalRequestedAt = requireTimestamp(
    input.originalRequestedAt,
    'originalRequestedAt',
  );
  const sourceAccountId = deriveSourceAccountId(payloads);
  let providerRequestCount = 0;
  let localWriteSentinelCount = 0;

  const sentinel = (boundary) => {
    localWriteSentinelCount += 1;
    const error = new Error('Meta K2 Lark payload diagnostic reached a blocked boundary');
    error.code = LOCAL_WRITE_SENTINEL;
    error.details = { boundary };
    throw error;
  };
  const workStore = {
    async beginWork() {
      return { superseded: false, completed: false };
    },
    async loadPhase({ phase }) {
      if (phase === SOURCE_PHASE) return { complete: true, state: sourceState };
      return null;
    },
    async listPhaseUnits() {
      return {
        units: payloads.map((payload, sequence) => ({ sequence, payload })),
      };
    },
    async savePhase({ phase }) {
      return sentinel(`workStore.savePhase:${phase}`);
    },
    async completeWork() {
      return sentinel('workStore.completeWork');
    },
  };
  const historyStore = Object.fromEntries([
    'upsertOrganicAccountDailyFact',
    'upsertAdsEntityState',
    'upsertAdsDailyFact',
    'saveCoverageRun',
    'saveCoverageEntities',
  ].map((method) => [method, async () => sentinel(`historyStore.${method}`)]));
  const adapter = new Proxy({}, {
    get() {
      providerRequestCount += 1;
      throw auditError(
        'Meta K2 Lark diagnostic attempted a Provider read after source completion',
        'META_K2_FAILURE_AUDIT_PROVIDER_READ_ATTEMPTED',
      );
    },
  });
  const syncEngine = {
    async planByKey() {
      return sentinel('syncEngine.planByKey:lark_payload_preflight_complete');
    },
    async executePlan() {
      return sentinel('syncEngine.executePlan');
    },
  };

  try {
    const result = await processMetaEndToEndSync({
      connectorKey: identity.connectorKey,
      operation: {
        stable: true,
        operationId: identity.operationId,
        workKey: identity.workKey,
        generation,
        originalRequestedAt,
      },
      resumableWorkStore: workStore,
      adapter,
      sourceAccountId,
      accountKey: identity.accountKey,
      customerProfile: identity.customerProfile,
      customerKey: identity.customerKey,
      syncRunId: identity.syncRunId,
      sourceTimezone: 'Asia/Bangkok',
      dateRange: {
        since: identity.periodStart,
        until: identity.periodEnd,
      },
      limits: {
        sourceMaxPages: 100,
        sourceMaxUnits: 500,
        sourceMaxRows: 50_000,
        sourceMaxUnitBytes: 1_048_576,
        d1RowsPerInvocation: 250,
        larkTablesPerInvocation: 4,
      },
      d1WriteEnabled: true,
      larkWriteEnabled: true,
      postSourceMaterializationEnabled: false,
      historyStore,
      repository,
      syncEngine,
      tables,
      assertLockActive: async () => undefined,
    });
    return deepFreeze({
      accepted: false,
      unexpectedTerminalResult: result?.status ?? null,
      tablesChecked: 0,
      rowsChecked: 0,
      fieldsChecked: 0,
      issueCount: 0,
      issues: [],
      issuesTruncated: false,
      providerRequestCount,
      localWriteSentinelCount,
      d1WriteCount: 0,
      larkWriteCount: 0,
      remoteMutationCount: 0,
    });
  } catch (error) {
    if (error?.code === LOCAL_WRITE_SENTINEL
      && error?.details?.boundary === 'syncEngine.planByKey:lark_payload_preflight_complete') {
      return deepFreeze({
        accepted: true,
        unexpectedTerminalResult: null,
        tablesChecked: 4,
        rowsChecked: null,
        fieldsChecked: null,
        issueCount: 0,
        issues: [],
        issuesTruncated: false,
        providerRequestCount,
        localWriteSentinelCount,
        d1WriteCount: 0,
        larkWriteCount: 0,
        remoteMutationCount: 0,
      });
    }
    if (error?.code === 'LARK_PREFLIGHT_FAILED') {
      return deepFreeze({
        accepted: false,
        unexpectedTerminalResult: null,
        ...safeLarkPreflightDiagnostics(error?.details),
        providerRequestCount,
        localWriteSentinelCount,
        d1WriteCount: 0,
        larkWriteCount: 0,
        remoteMutationCount: 0,
      });
    }
    return deepFreeze({
      accepted: false,
      unexpectedTerminalResult: null,
      tablesChecked: 0,
      rowsChecked: 0,
      fieldsChecked: 0,
      issueCount: 1,
      issues: [{
        tableKey: null,
        fieldName: null,
        reasonCode: 'SOURCE_ASSEMBLY_OR_RUNTIME_INVALID',
        destinationType: null,
        incomingType: null,
        affectedRows: 0,
      }],
      issuesTruncated: false,
      replayError: describeReplayError(error),
      providerRequestCount,
      localWriteSentinelCount,
      d1WriteCount: 0,
      larkWriteCount: 0,
      remoteMutationCount: 0,
    });
  }
}

export function selectMetaK2AuditColumn(columns, candidates, fieldName) {
  const available = new Set(requireArray(columns, 'columns').map((value) => requireText(value, 'column')));
  const selected = requireArray(candidates, 'candidates').find((candidate) => available.has(candidate));
  if (!selected) {
    throw auditError(
      `Meta K2 audit schema is missing ${fieldName}`,
      'META_K2_FAILURE_AUDIT_SCHEMA_INVALID',
      { fieldName, candidates },
    );
  }
  return selected;
}

function deriveSourceAccountId(payloads) {
  const accountRows = payloads
    .filter((payload) => payload?.datasetKey === 'meta_ads.account.latest')
    .flatMap((payload) => Array.isArray(payload?.rows) ? payload.rows : []);
  if (accountRows.length !== 1) {
    throw auditError(
      'Meta K2 diagnostic requires exactly one staged account row',
      'META_K2_FAILURE_AUDIT_ACCOUNT_INVALID',
      { observed: accountRows.length },
    );
  }
  const row = requireObject(accountRows[0], 'Meta Ads account row');
  return requireText(row.account_id ?? row.id, 'Meta Ads account identity');
}

function safeLarkPreflightDiagnostics(value = {}) {
  const details = value && typeof value === 'object' ? value : {};
  const issues = Array.isArray(details.issues)
    ? details.issues.map((issue) => Object.freeze({
      tableKey: safeNullableText(issue?.tableKey),
      fieldName: safeNullableText(issue?.fieldName),
      reasonCode: safeNullableText(issue?.reasonCode) ?? 'SERIALIZATION_INVALID',
      destinationType: Number.isInteger(issue?.destinationType)
        ? issue.destinationType
        : null,
      incomingType: safeNullableText(issue?.incomingType),
      affectedRows: safeNonNegativeInteger(issue?.affectedRows),
    }))
    : [];
  return deepFreeze({
    tablesChecked: safeNonNegativeInteger(details.tablesChecked),
    rowsChecked: safeNonNegativeInteger(details.rowsChecked),
    fieldsChecked: safeNonNegativeInteger(details.fieldsChecked),
    issueCount: safeNonNegativeInteger(details.issueCount ?? issues.length),
    issues,
    issuesTruncated: details.issuesTruncated === true,
  });
}

function describeReplayError(error) {
  const details = error?.details && typeof error.details === 'object'
    ? error.details
    : {};
  const safeDetails = Object.fromEntries(Object.entries(details)
    .filter(([key]) => SAFE_DETAIL_FIELDS.has(key))
    .map(([key, value]) => [key, safeScalar(value)]));
  return deepFreeze({
    name: typeof error?.name === 'string' ? error.name : typeof error,
    code: typeof error?.code === 'string' ? error.code : 'META_K2_REPLAY_UNCLASSIFIED',
    message: sanitizeMessage(error instanceof Error ? error.message : String(error)),
    detailKeys: Object.keys(details).sort(),
    safeDetails,
    detailsFingerprint: sha256(stableJson(details)),
  });
}

function describeErrorValue(value, key) {
  if (typeof value === 'string') {
    const parsed = parseJson(value);
    if (parsed !== null) return describeErrorValue(parsed, key);
    if (/message/iu.test(key)) return sanitizeMessage(value);
    if (/code|name/iu.test(key)) return value.slice(0, 160);
    return Object.freeze({ sha256: sha256(value), length: value.length });
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((entry) => describeErrorValue(entry, key));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => {
      if (/token|authorization|secret|password|payload|cursor|entityId|accountId|sourceAccount/iu.test(nestedKey)) {
        return [nestedKey, '[REDACTED]'];
      }
      if (/message|code|name|field|dataset|detail|cause/iu.test(nestedKey)) {
        return [nestedKey, describeErrorValue(nestedValue, nestedKey)];
      }
      return [nestedKey, Object.freeze({ sha256: sha256(stableJson(nestedValue)) })];
    }));
  }
  return null;
}

function sanitizeMessage(value) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/giu, '[URL_REDACTED]')
    .replace(/\b(?:act_)?\d{8,}\b/gu, '[IDENTIFIER_REDACTED]')
    .slice(0, 500);
}

function parseJson(value) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeScalar(value) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return sanitizeMessage(value);
  return Object.freeze({ sha256: sha256(stableJson(value)) });
}

function safeNullableText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text.slice(0, 160);
}

function safeNonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw auditError(
      `${fieldName} must be a positive epoch timestamp`,
      'META_K2_FAILURE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw auditError(
      `${fieldName} must be an object`,
      'META_K2_FAILURE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw auditError(
      `${fieldName} must be an array`,
      'META_K2_FAILURE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw auditError(
      `${fieldName} is required`,
      'META_K2_FAILURE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function auditError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

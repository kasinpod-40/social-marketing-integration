import {
  readLarkNumber,
  readLarkText,
} from '../../packages/connectors/src/shared/lark-cell-value.js';

export const LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION =
  'lark_dashboard_compatibility_freeze_v1';

export const LARK_DASHBOARD_WRITE_CONTRACT_STATUS =
  'unsupported_public_openapi_contract';

export const LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION =
  'BACKFILL_WINDOW_SELECT_WITHOUT_DASHBOARD_OR_FIELD_MUTATION';

export const LARK_DASHBOARD_RETIRED_MUTATION_FLAGS = Object.freeze([
  '--execute',
  '--statistics-probe-only',
]);

export const LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES = deepFreeze({
  metricKey: {
    fieldId: 'fldGvd3tw8',
    fieldName: 'metric_key',
    type: 1,
    isPrimary: true,
  },
  displayName: {
    fieldId: 'fldE4Nezjd',
    fieldName: 'display_name',
    type: 1,
    isPrimary: false,
  },
  numberWindow: {
    fieldId: 'fldbPCldTL',
    fieldName: 'window_days',
    type: 2,
    isPrimary: false,
  },
  preservedWindowSelect: {
    fieldId: 'fldMlTUP3Z',
    fieldName: '__mkt_legacy_window_days_single_select_v1',
    type: 3,
    isPrimary: false,
  },
  windowSelectV2: {
    fieldId: 'fldraj0QP8',
    fieldName: '__mkt_legacy_window_days_single_select_v2',
    type: 3,
    isPrimary: false,
  },
  displaySelectV1: {
    fieldId: 'fldZB452Z2',
    fieldName: '__mkt_legacy_display_name_single_select_v1',
    type: 3,
    isPrimary: false,
  },
  displaySelectV2: {
    fieldId: 'fldHNUhCfl',
    fieldName: '__mkt_legacy_display_name_single_select_v2',
    type: 3,
    isPrimary: false,
  },
});

const REPORT_METRIC_TABLE_KEY = 'mktReportMetricValues';
const REPORT_METRIC_TABLE_ENV = 'LARK_TABLE_MKT_REPORT_METRIC_VALUES';
const MAX_REPORT_METRIC_RECORDS = 500;
const WINDOW_PRESETS = Object.freeze([1, 3, 7, 30]);
const WINDOW_PRESET_TEXT = Object.freeze(WINDOW_PRESETS.map(String));

/**
 * The Integration Workspace keeps the audited Number field as the canonical write/planning field while
 * preserving the SingleSelect physical identity used by existing Dashboard slicers and charts.
 * Other customer profiles keep the normal executable schema unchanged.
 */
export function buildLarkDashboardCompatibilityReportSchema(schema, env = {}) {
  if (!Array.isArray(schema)) throw new TypeError('schema must be an array');
  if (!isIntegrationWorkspace(env)) return schema;
  return deepFreeze(schema.map((table) => {
    if (table?.key !== REPORT_METRIC_TABLE_KEY) return clone(table);
    return {
      ...clone(table),
      fields: table.fields.map((field) => {
        if (normalizeName(field?.fieldName) !== 'window_days') return clone(field);
        return {
          ...clone(field),
          type: 2,
          uiType: 'Number',
          primary: false,
          property: { formatter: '0' },
        };
      }),
    };
  }));
}

/**
 * Read-only exact-state admission for the permanent Dashboard Compatibility Freeze.
 * No semantic-name fallback is accepted: every reviewed physical Field ID/name/type/primary owner must match.
 */
export async function inspectLarkDashboardCompatibilityFreeze({ client, env = {} } = {}) {
  if (!isIntegrationWorkspace(env)) return deepFreeze({
    applicable: false,
    compatible: false,
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    blockerCount: 0,
    blockers: [],
  });
  requireReadClient(client);
  const tableId = requireText(env[REPORT_METRIC_TABLE_ENV], REPORT_METRIC_TABLE_ENV);
  const fields = await client.listFields({ tableId });
  const records = await client.listRecords({
    tableId,
    includeRecordMetadata: false,
  });
  const blockers = [];

  if (records.length > MAX_REPORT_METRIC_RECORDS) blockers.push(blocker(
    'REPORT_METRIC_COMPATIBILITY_FREEZE_RECORD_BOUND_EXCEEDED',
    { recordCount: records.length, maxRecords: MAX_REPORT_METRIC_RECORDS },
  ));

  const resolved = {};
  for (const [key, expected] of Object.entries(LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES)) {
    const matches = fields.filter((field) => String(field?.fieldId ?? '') === expected.fieldId);
    const actual = matches[0] ?? null;
    const expectedPrimary = expected.isPrimary === true;
    const actualPrimary = actual?.isPrimary === true;
    if (matches.length !== 1
      || normalizeName(actual?.fieldName) !== normalizeName(expected.fieldName)
      || Number(actual?.type) !== expected.type
      || actualPrimary !== expectedPrimary) {
      blockers.push(blocker('REPORT_METRIC_COMPATIBILITY_FREEZE_FIELD_IDENTITY_MISMATCH', {
        identityKey: key,
        expectedFieldName: expected.fieldName,
        expectedType: expected.type,
        expectedPrimary,
        fieldCount: matches.length,
        actualFieldName: actual?.fieldName ?? null,
        actualType: actual?.type ?? null,
        actualPrimary,
      }));
      continue;
    }
    resolved[key] = actual;
  }

  const preservedWindow = resolved.preservedWindowSelect;
  if (preservedWindow) {
    const options = (preservedWindow.property?.options ?? []).map((option) => String(option?.name ?? '').trim());
    if (JSON.stringify(options) !== JSON.stringify(WINDOW_PRESET_TEXT)) blockers.push(blocker(
      'REPORT_METRIC_COMPATIBILITY_FREEZE_WINDOW_OPTIONS_INVALID',
      { expectedOptions: WINDOW_PRESET_TEXT, actualOptions: options },
    ));
  }

  let canonicalDisplayCount = 0;
  let archivedDisplayConflictCount = 0;
  let canonicalOnlyDisplayCount = 0;
  let windowParityCount = 0;
  if (blockers.length === 0) {
    for (const record of records) {
      const canonicalDisplay = readLarkText(
        readFieldValue(record.fields, resolved.displayName.fieldName),
        { allowNull: true, label: 'display_name' },
      );
      const displayArchives = [resolved.displaySelectV1, resolved.displaySelectV2]
        .map((field) => readSingleSelect(readFieldValue(record.fields, field.fieldName)))
        .filter((value) => value !== null);
      const uniqueDisplayArchives = [...new Set(displayArchives)];
      if (canonicalDisplay === null) {
        blockers.push(blocker('REPORT_METRIC_COMPATIBILITY_FREEZE_CANONICAL_DISPLAY_MISSING', {
          recordCount: records.length,
          sourceFieldCount: 2,
          archivedConflict: uniqueDisplayArchives.length > 1,
        }));
        break;
      }
      canonicalDisplayCount += 1;
      if (uniqueDisplayArchives.length === 0) canonicalOnlyDisplayCount += 1;
      if (uniqueDisplayArchives.length > 1) archivedDisplayConflictCount += 1;

      const numberWindow = readLarkNumber(
        readFieldValue(record.fields, resolved.numberWindow.fieldName),
        { allowNull: true, label: 'window_days' },
      );
      const preservedSelect = readWindowPreset(
        readFieldValue(record.fields, resolved.preservedWindowSelect.fieldName),
      );
      const secondarySelect = readWindowPreset(
        readFieldValue(record.fields, resolved.windowSelectV2.fieldName),
      );
      if (numberWindow === null) {
        if (preservedSelect !== null || secondarySelect !== null) {
          blockers.push(blocker('REPORT_METRIC_COMPATIBILITY_FREEZE_WINDOW_NULL_CONFLICT', {
            recordCount: records.length,
          }));
          break;
        }
        windowParityCount += 1;
        continue;
      }
      if (!Number.isSafeInteger(numberWindow) || !WINDOW_PRESETS.includes(numberWindow)
        || preservedSelect !== numberWindow
        || (secondarySelect !== null && secondarySelect !== numberWindow)) {
        blockers.push(blocker('REPORT_METRIC_COMPATIBILITY_FREEZE_WINDOW_PARITY_MISMATCH', {
          recordCount: records.length,
          canonicalWindow: numberWindow,
          preservedWindow: preservedSelect,
          secondaryWindow: secondarySelect,
        }));
        break;
      }
      windowParityCount += 1;
    }
  }

  return deepFreeze({
    applicable: true,
    compatible: blockers.length === 0,
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    tableKey: REPORT_METRIC_TABLE_KEY,
    recordCount: records.length,
    canonicalDisplayCount,
    canonicalOnlyDisplayCount,
    archivedDisplayConflictCount,
    windowParityCount,
    blockerCount: blockers.length,
    blockers,
    fieldMutationCount: 0,
    recordMutationCount: 0,
    deleteCount: 0,
  });
}

export function buildLarkDashboardCompatibilityFreezeAudit({
  entrypoint = 'scripts/lark-dashboard-compatibility-freeze-audit.mjs',
} = {}) {
  return deepFreeze({
    ok: true,
    mode: 'read-only-static-audit',
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    decision: 'LARK_DASHBOARD_COMPATIBILITY_FREEZE_ACTIVE',
    entrypoint,
    dashboardBlockWriteContract: LARK_DASHBOARD_WRITE_CONTRACT_STATUS,
    dashboardPatchAllowed: false,
    statisticsPatchAllowed: false,
    windowChartPatchAllowed: false,
    slicerPatchAllowed: false,
    fieldRenameAllowed: false,
    fieldDeleteAllowed: false,
    recordDeleteAllowed: false,
    legacyFieldPreservationRequired: true,
    reportRecordCountPreserved: 86,
    baselineIncompleteNullRecordCountPreserved: 24,
    dashboardCountPreserved: 6,
    organicStatisticsCountPreserved: 17,
    slicerCountPreserved: 5,
    windowChartCountPreserved: 7,
    compatibilityFields: LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
    compatibilityRecordWriteStatus: 'guarded_window_select_backfill_available',
    compatibilityRecordWriteEntrypoint:
      'scripts/lark-dashboard-compatibility-record-backfill.mjs',
    remoteLarkMutationCount: 0,
    remoteD1MutationCount: 0,
    workerDeploymentCount: 0,
    queueSendCount: 0,
    production: 'BLOCKED',
  });
}

export function buildLarkDashboardMutationBlockedFailure({
  entrypoint,
  args = [],
} = {}) {
  const normalizedArgs = normalizeArgs(args);
  return deepFreeze({
    ok: false,
    contractVersion: LARK_DASHBOARD_COMPATIBILITY_FREEZE_VERSION,
    stage: 'compatibility-freeze',
    code: 'LARK_DASHBOARD_WRITE_CONTRACT_UNSUPPORTED',
    message:
      'Dashboard Block mutation is retired because no supported public Lark OpenAPI write contract is available',
    details: {
      entrypoint: requireText(entrypoint, 'entrypoint'),
      requestedArguments: normalizedArgs,
      dashboardBlockWriteContract: LARK_DASHBOARD_WRITE_CONTRACT_STATUS,
      replacementCommand: 'node scripts/lark-dashboard-compatibility-freeze-audit.mjs',
      dashboardPatchAllowed: false,
      fieldMutationAllowed: false,
      recordMutationAllowed: false,
      remoteMutationCount: 0,
    },
    production: 'BLOCKED',
  });
}

export function assertLarkDashboardCompatibilityRecordBackfillConfirmation(value) {
  if (value !== LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION) {
    const error = new Error(
      'Explicit confirmation of the Record-only Dashboard compatibility backfill is required',
    );
    error.name = 'LarkDashboardCompatibilityFreezeError';
    error.code = 'LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION_REQUIRED';
    error.details = Object.freeze({
      envName: 'CONFIRM_LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL',
      requiredValue: LARK_DASHBOARD_COMPATIBILITY_RECORD_BACKFILL_CONFIRMATION,
      dashboardPatchAllowed: false,
      fieldMutationAllowed: false,
      recordDeleteAllowed: false,
      remoteMutationCount: 0,
    });
    throw error;
  }
  return true;
}

export function hasRetiredDashboardMutationArgument(args = []) {
  const normalizedArgs = new Set(normalizeArgs(args));
  return LARK_DASHBOARD_RETIRED_MUTATION_FLAGS.some((flag) => normalizedArgs.has(flag));
}

function isIntegrationWorkspace(env) {
  return env?.MKT_ENV === 'development'
    && env?.MKT_CUSTOMER_PROFILE === 'integration_workspace';
}

function readWindowPreset(value) {
  const text = readSingleSelect(value);
  if (text === null) return null;
  if (!/^(?:1|3|7|30)$/u.test(text)) return Number.NaN;
  return Number(text);
}

function readSingleSelect(value) {
  if (Array.isArray(value) && value.length > 1) throw new TypeError(
    'Dashboard compatibility SingleSelect contains multiple entries',
  );
  return readLarkText(value, { allowNull: true, label: 'Dashboard compatibility SingleSelect' });
}

function readFieldValue(fields, fieldName) {
  const entry = Object.entries(fields ?? {}).find(
    ([name]) => normalizeName(name) === normalizeName(fieldName),
  );
  return entry?.[1] ?? null;
}

function blocker(code, details = {}) {
  return deepFreeze({
    code,
    tableKey: REPORT_METRIC_TABLE_KEY,
    ...details,
  });
}

function requireReadClient(client) {
  if (typeof client?.listFields !== 'function' || typeof client?.listRecords !== 'function') {
    throw new TypeError('Dashboard compatibility inspection requires listFields/listRecords');
  }
}

function normalizeArgs(args) {
  if (!Array.isArray(args)) throw new TypeError('args must be an array');
  return args.map((value) => String(value));
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, clone(nested)]));
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

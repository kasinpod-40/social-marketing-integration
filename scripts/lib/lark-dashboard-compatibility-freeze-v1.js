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
  metricKey: { fieldId: 'fldGvd3tw8', fieldName: 'metric_key', type: 1 },
  displayName: { fieldId: 'fldE4Nezjd', fieldName: 'display_name', type: 1 },
  numberWindow: { fieldId: 'fldbPCldTL', fieldName: 'window_days', type: 2 },
  preservedWindowSelect: {
    fieldId: 'fldMlTUP3Z',
    fieldName: '__mkt_legacy_window_days_single_select_v1',
    type: 3,
  },
  windowSelectV2: {
    fieldId: 'fldraj0QP8',
    fieldName: '__mkt_legacy_window_days_single_select_v2',
    type: 3,
  },
  displaySelectV1: {
    fieldId: 'fldZB452Z2',
    fieldName: '__mkt_legacy_display_name_single_select_v1',
    type: 3,
  },
  displaySelectV2: {
    fieldId: 'fldHNUhCfl',
    fieldName: '__mkt_legacy_display_name_single_select_v2',
    type: 3,
  },
});

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

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}

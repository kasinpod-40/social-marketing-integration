import { createHash } from 'node:crypto';
import { planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';
import { DASHBOARD_REPORT_PRESET_DAYS } from '../../packages/config/src/report-settings.seed.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';
import {
  readLarkNumber,
  readLarkText,
} from '../../packages/connectors/src/shared/lark-cell-value.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration as applyBaseMigration,
  planReportMetricValueFieldMigration as planBaseMigration,
  safeReportMetricValueFieldMigrationEvidence,
} from './report-metric-value-field-migration.js';

export {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  safeReportMetricValueFieldMigrationEvidence,
};

export const REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION =
  'report_metric_value_field_migration_recovery_v2';

const TABLE_KEY = 'mktReportMetricValues';
const DISPLAY_FIELD = Object.freeze({
  fieldName: 'display_name',
  legacyName: '__mkt_legacy_display_name_single_select_v1',
  sourceType: 3,
  targetType: 1,
  conversion: 'single_select_to_text',
});
const WINDOW_FIELD = Object.freeze({
  fieldName: 'window_days',
  legacyName: '__mkt_legacy_window_days_single_select_v1',
  secondaryLegacyName: '__mkt_legacy_window_days_single_select_v2',
  sourceType: 3,
  targetType: 2,
  conversion: 'single_select_to_preset_number',
});
const MAX_RECORDS = 500;
const VERIFY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);
const RECOVERABLE_BLOCKERS = Object.freeze(new Set([
  'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_WITHOUT_SOURCE',
  'REPORT_METRIC_FIELD_MIGRATION_STATE_UNSUPPORTED',
]));

/**
 * Preserve the unchanged v1 migration for normal states. Recovery remains authoritative after its
 * deterministic v2 marker exists, so an interrupted phase can never fall back to a single-source
 * v1 read and silently ignore the retained secondary legacy field.
 */
export async function planReportMetricValueFieldMigration(input = {}) {
  const base = await planBaseMigration(input);
  if (base.repairable !== true && !isRecoverableBasePlan(base)) return base;
  const inspected = await inspectTransitionalState(input);
  if (base.repairable === true && inspected.recoveryMarkerPresent !== true) return base;
  return buildPublicPlan(inspected);
}

export async function applyReportMetricValueFieldMigration(input = {}) {
  const env = input.env ?? {};
  if (env.CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION
    !== REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION) {
    throw recoveryError(
      `Apply requires CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION=${REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION}`,
      'REPORT_METRIC_FIELD_MIGRATION_CONFIRMATION_REQUIRED',
    );
  }

  const base = await planBaseMigration(input);
  if (base.repairable !== true && !isRecoverableBasePlan(base)) return applyBaseMigration(input);

  const inspectedCandidate = await inspectTransitionalState(input);
  if (base.repairable === true && inspectedCandidate.recoveryMarkerPresent !== true) {
    return applyBaseMigration(input);
  }

  const client = requireClient(input.client);
  const sleep = input.sleepImpl ?? sleepMs;
  let inspected = inspectedCandidate;
  assertRecoveryRepairable(inspected);
  const initialRecordCount = inspected.recordCount;
  const initialLegacyFingerprints = new Map(inspected.legacyFieldFingerprints);

  let fieldMutationCount = 0;
  let canonicalValueWriteCount = 0;
  let recordBatchWriteCount = 0;

  if (inspected.display.pendingUpdates.length > 0) {
    const updates = inspected.display.pendingUpdates.map((update) => ({
      recordId: update.recordId,
      fields: { [DISPLAY_FIELD.fieldName]: update.value },
    }));
    await writeCanonicalValues(client, inspected.tableId, updates, DISPLAY_FIELD.fieldName);
    canonicalValueWriteCount += updates.length;
    recordBatchWriteCount += 1;
    inspected = await waitForTransition({
      input,
      sleep,
      previousSignature: stateSignature(inspected),
      expected: (next) => next.display.pendingUpdates.length === 0,
    });
    assertRecoveryRepairable(inspected);
  }

  for (let phase = 1; phase <= 4; phase += 1) {
    if (!inspected.window.pending) break;
    const previousSignature = stateSignature(inspected);
    if (inspected.window.nextStep === 'archive_primary_legacy') {
      await client.updateField({
        tableId: inspected.tableId,
        fieldId: inspected.window.archiveField.fieldId,
        field: renameFieldMutation(
          inspected.window.archiveField,
          WINDOW_FIELD.secondaryLegacyName,
        ),
      });
      fieldMutationCount += 1;
    } else if (inspected.window.nextStep === 'rename_canonical_source') {
      await client.updateField({
        tableId: inspected.tableId,
        fieldId: inspected.window.renameField.fieldId,
        field: renameFieldMutation(inspected.window.renameField, WINDOW_FIELD.legacyName),
      });
      fieldMutationCount += 1;
    } else if (inspected.window.nextStep === 'create_canonical') {
      await client.createField({
        tableId: inspected.tableId,
        field: inspected.window.targetFieldContract,
      });
      fieldMutationCount += 1;
    } else if (inspected.window.nextStep === 'backfill_canonical') {
      const updates = inspected.window.pendingUpdates.map((update) => ({
        recordId: update.recordId,
        fields: { [WINDOW_FIELD.fieldName]: update.value },
      }));
      await writeCanonicalValues(client, inspected.tableId, updates, WINDOW_FIELD.fieldName);
      canonicalValueWriteCount += updates.length;
      recordBatchWriteCount += 1;
    } else {
      throw recoveryError(
        'Report Metric Values transitional recovery reached an unsupported step',
        'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_STEP_INVALID',
        publicMigration(inspected.window),
      );
    }

    inspected = await waitForTransition({
      input,
      sleep,
      previousSignature,
      expected: (next) => stateSignature(next) !== previousSignature,
    });
    assertRecoveryRepairable(inspected);
  }

  if (inspected.display.pending || inspected.window.pending) {
    throw recoveryError(
      'Report Metric Values transitional recovery exceeded its bounded phase count',
      'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_PHASE_BOUND_EXCEEDED',
      {
        display: publicMigration(inspected.display),
        window: publicMigration(inspected.window),
      },
    );
  }
  if (inspected.recordCount !== initialRecordCount) {
    throw recoveryError(
      'Report Metric Values record count changed during transitional recovery',
      'REPORT_METRIC_FIELD_MIGRATION_SOURCE_CHANGED',
      { expectedRecordCount: initialRecordCount, actualRecordCount: inspected.recordCount },
    );
  }
  assertLegacyFingerprintsUnchanged(initialLegacyFingerprints, inspected.legacyFieldFingerprints);

  const plan = buildPublicPlan(inspected);
  return deepFreeze({
    ...plan,
    ok: true,
    mode: 'apply',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    pendingMigrationCount: 0,
    blockerCount: 0,
    repairable: true,
    fieldMutationCount,
    canonicalValueWriteCount,
    recordBatchWriteCount,
    remoteMutationCount: fieldMutationCount + recordBatchWriteCount,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    appliedMigrations: plan.migrations,
  });
}

async function inspectTransitionalState(input = {}) {
  const client = requireClient(input.client);
  const env = input.env ?? {};
  const schema = input.schema ?? LARK_REPORT_SCHEMA_V2;
  const schemaVersion = input.schemaVersion ?? LARK_REPORT_SCHEMA_V2_VERSION;
  const validateSchema = input.validateSchema ?? validateReportSchemaV2;
  validateSchema(schema);

  const tableContract = schema.find((table) => table.key === TABLE_KEY);
  if (!tableContract) throw recoveryError(
    'Report Metric Values table contract is missing',
    'REPORT_METRIC_FIELD_MIGRATION_CONTRACT_MISSING',
  );
  const resolution = (await planLarkSchema({
    client,
    env,
    schema,
    schemaVersion,
    validateSchema,
  })).resolvedTables.find((table) => table.tableKey === TABLE_KEY);
  if (!resolution?.tableId) return blockedInspection(schemaVersion, [
    safeBlocker('REPORT_METRIC_FIELD_MIGRATION_TABLE_UNRESOLVED'),
  ]);

  const fields = await client.listFields({ tableId: resolution.tableId });
  const records = await client.listRecords({
    tableId: resolution.tableId,
    includeRecordMetadata: false,
  });
  if (records.length > MAX_RECORDS) return blockedInspection(schemaVersion, [
    safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECORD_BOUND_EXCEEDED', {
      recordCount: records.length,
      maxRecords: MAX_RECORDS,
    }),
  ]);

  const desiredDisplay = requireDesiredField(tableContract, DISPLAY_FIELD);
  const desiredWindow = requireDesiredField(tableContract, WINDOW_FIELD);
  const display = inspectDisplay({ fields, records, desired: desiredDisplay });
  const window = inspectWindow({ fields, records, desired: desiredWindow });
  const blockers = [display.blocker, window.blocker].filter(Boolean);
  const legacyFieldFingerprints = new Map([
    ...display.legacyFieldFingerprints,
    ...window.legacyFieldFingerprints,
  ]);
  return deepFreeze({
    schemaVersion,
    tableId: resolution.tableId,
    recordCount: records.length,
    recoveryMarkerPresent: fields.some(
      (field) => normalizeName(field.fieldName) === normalizeName(WINDOW_FIELD.secondaryLegacyName),
    ),
    display,
    window,
    blockers,
    legacyFieldFingerprints: Object.freeze([...legacyFieldFingerprints.entries()]),
  });
}

function inspectDisplay(input) {
  const canonical = uniqueField(input.fields, DISPLAY_FIELD.fieldName);
  const legacy = uniqueField(input.fields, DISPLAY_FIELD.legacyName);
  if (canonical.blocker || legacy.blocker) return blockedMigration(DISPLAY_FIELD, canonical.blocker ?? legacy.blocker);
  if (!canonical.field || Number(canonical.field.type) !== DISPLAY_FIELD.targetType) return blockedMigration(
    DISPLAY_FIELD,
    safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_DISPLAY_STATE_UNSUPPORTED', {
      tableKey: TABLE_KEY,
      fieldName: DISPLAY_FIELD.fieldName,
      canonicalType: canonical.field?.type ?? null,
      canonicalFieldCount: canonical.field ? 1 : 0,
    }),
  );
  if (legacy.field && Number(legacy.field.type) !== DISPLAY_FIELD.sourceType) return blockedMigration(
    DISPLAY_FIELD,
    safeBlocker('REPORT_METRIC_FIELD_MIGRATION_LEGACY_TYPE_INVALID', {
      tableKey: TABLE_KEY,
      fieldName: DISPLAY_FIELD.fieldName,
      expectedType: DISPLAY_FIELD.sourceType,
      actualType: legacy.field.type,
    }),
  );

  const pendingUpdates = [];
  const sourceRows = [];
  const canonicalRows = [];
  let populatedSourceCount = 0;
  for (const record of sortedRecords(input.records)) {
    const recordId = requireText(record.recordId, 'recordId');
    const source = legacy.field
      ? readSingleSelectValue(readFieldValue(record.fields, legacy.field.fieldName))
      : null;
    const target = readLarkText(readFieldValue(record.fields, canonical.field.fieldName), {
      allowNull: true,
      label: DISPLAY_FIELD.fieldName,
    });
    if (source !== null) populatedSourceCount += 1;
    if (source !== null && target !== null && source !== target) return blockedMigration(
      DISPLAY_FIELD,
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH', {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        recordCount: input.records.length,
      }),
    );
    if (source !== null && target === null) pendingUpdates.push(deepFreeze({ recordId, value: source }));
    sourceRows.push([recordId, source]);
    canonicalRows.push([recordId, target]);
  }
  const state = pendingUpdates.length > 0 ? 'needs_backfill' : (legacy.field ? 'converged' : 'not_required');
  const legacyFieldFingerprints = legacy.field
    ? [[legacy.field.fieldId, fingerprint(sourceRows)]]
    : [];
  return deepFreeze({
    ...DISPLAY_FIELD,
    state,
    nextStep: pendingUpdates.length > 0 ? 'backfill_canonical' : null,
    pending: pendingUpdates.length > 0,
    recordCount: input.records.length,
    populatedSourceCount,
    pendingRecordCount: pendingUpdates.length,
    sourceFingerprint: legacy.field ? fingerprint(sourceRows) : null,
    canonicalFingerprint: fingerprint(canonicalRows),
    sourceFieldCount: legacy.field ? 1 : 0,
    pendingUpdates: Object.freeze(pendingUpdates),
    targetFieldContract: clone(input.desired),
    legacyFieldFingerprints: Object.freeze(legacyFieldFingerprints),
    blocker: null,
  });
}

function inspectWindow(input) {
  const canonical = uniqueField(input.fields, WINDOW_FIELD.fieldName);
  const primaryLegacy = uniqueField(input.fields, WINDOW_FIELD.legacyName);
  const secondaryLegacy = uniqueField(input.fields, WINDOW_FIELD.secondaryLegacyName);
  const ambiguity = canonical.blocker ?? primaryLegacy.blocker ?? secondaryLegacy.blocker;
  if (ambiguity) return blockedMigration(WINDOW_FIELD, ambiguity);
  for (const candidate of [primaryLegacy.field, secondaryLegacy.field].filter(Boolean)) {
    if (Number(candidate.type) !== WINDOW_FIELD.sourceType) return blockedMigration(
      WINDOW_FIELD,
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_LEGACY_TYPE_INVALID', {
        tableKey: TABLE_KEY,
        fieldName: WINDOW_FIELD.fieldName,
        expectedType: WINDOW_FIELD.sourceType,
        actualType: candidate.type,
      }),
    );
  }

  let sourceFields = [primaryLegacy.field, secondaryLegacy.field].filter(Boolean);
  let targetField = null;
  let state;
  let nextStep = null;
  let archiveField = null;
  let renameField = null;

  if (canonical.field && Number(canonical.field.type) === WINDOW_FIELD.targetType) {
    targetField = canonical.field;
    state = sourceFields.length > 0 ? 'canonical_present' : 'not_required';
  } else if (canonical.field && Number(canonical.field.type) === WINDOW_FIELD.sourceType) {
    sourceFields = [canonical.field, ...sourceFields];
    if (primaryLegacy.field && secondaryLegacy.field) return blockedMigration(
      WINDOW_FIELD,
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_LEGACY_ARCHIVE_AMBIGUOUS', {
        tableKey: TABLE_KEY,
        fieldName: WINDOW_FIELD.fieldName,
        sourceFieldCount: sourceFields.length,
      }),
    );
    if (primaryLegacy.field) {
      state = 'needs_archive_primary_legacy';
      nextStep = 'archive_primary_legacy';
      archiveField = primaryLegacy.field;
    } else {
      state = 'needs_rename';
      nextStep = 'rename_canonical_source';
      renameField = canonical.field;
    }
  } else if (!canonical.field && sourceFields.length > 0) {
    state = 'needs_create';
    nextStep = 'create_canonical';
  } else {
    return blockedMigration(
      WINDOW_FIELD,
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_WINDOW_STATE_UNSUPPORTED', {
        tableKey: TABLE_KEY,
        fieldName: WINDOW_FIELD.fieldName,
        canonicalType: canonical.field?.type ?? null,
        canonicalFieldCount: canonical.field ? 1 : 0,
        sourceFieldCount: sourceFields.length,
      }),
    );
  }

  const analysis = analyzeWindowRecords({
    records: input.records,
    sourceFields,
    targetField,
  });
  if (analysis.blocker) return blockedMigration(WINDOW_FIELD, analysis.blocker);
  if (state === 'canonical_present') {
    if (analysis.pendingUpdates.length > 0) {
      state = 'needs_backfill';
      nextStep = 'backfill_canonical';
    } else {
      state = 'converged';
    }
  }

  return deepFreeze({
    ...WINDOW_FIELD,
    state,
    nextStep,
    pending: !['converged', 'not_required'].includes(state),
    recordCount: input.records.length,
    populatedSourceCount: analysis.populatedSourceCount,
    pendingRecordCount: targetField
      ? analysis.pendingUpdates.length
      : analysis.populatedSourceCount,
    sourceFingerprint: analysis.sourceFingerprint,
    canonicalFingerprint: analysis.canonicalFingerprint,
    sourceFieldCount: sourceFields.length,
    pendingUpdates: analysis.pendingUpdates,
    targetFieldContract: clone(input.desired),
    legacyFieldFingerprints: analysis.legacyFieldFingerprints,
    archiveField,
    renameField,
    blocker: null,
  });
}

function analyzeWindowRecords(input) {
  const mergedRows = [];
  const canonicalRows = [];
  const valuesByFieldId = new Map(input.sourceFields.map((field) => [field.fieldId, []]));
  const pendingUpdates = [];
  let populatedSourceCount = 0;
  for (const record of sortedRecords(input.records)) {
    const recordId = requireText(record.recordId, 'recordId');
    const converted = [];
    for (const field of input.sourceFields) {
      const raw = readSingleSelectValue(readFieldValue(record.fields, field.fieldName));
      const value = raw === null ? null : convertWindowValue(raw);
      valuesByFieldId.get(field.fieldId).push([recordId, value]);
      if (value !== null) converted.push(value);
    }
    const unique = [...new Set(converted)];
    if (unique.length > 1) return {
      blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT', {
        tableKey: TABLE_KEY,
        fieldName: WINDOW_FIELD.fieldName,
        recordCount: input.records.length,
        sourceFieldCount: input.sourceFields.length,
      }),
    };
    const merged = unique[0] ?? null;
    if (merged !== null) populatedSourceCount += 1;
    const canonical = input.targetField
      ? readLarkNumber(readFieldValue(record.fields, input.targetField.fieldName), {
        allowNull: true,
        label: WINDOW_FIELD.fieldName,
      })
      : null;
    if (merged !== null && canonical !== null && merged !== canonical) return {
      blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH', {
        tableKey: TABLE_KEY,
        fieldName: WINDOW_FIELD.fieldName,
        recordCount: input.records.length,
      }),
    };
    if (merged !== null && canonical === null && input.targetField) {
      pendingUpdates.push(deepFreeze({ recordId, value: merged }));
    }
    mergedRows.push([recordId, merged]);
    canonicalRows.push([recordId, canonical]);
  }
  return {
    populatedSourceCount,
    pendingUpdates: Object.freeze(pendingUpdates),
    sourceFingerprint: fingerprint(mergedRows),
    canonicalFingerprint: input.targetField ? fingerprint(canonicalRows) : null,
    legacyFieldFingerprints: Object.freeze(
      [...valuesByFieldId.entries()].map(([fieldId, rows]) => [fieldId, fingerprint(rows)]),
    ),
  };
}

async function waitForTransition(input) {
  let latest = null;
  for (const delayMs of VERIFY_DELAYS_MS) {
    if (delayMs > 0) await input.sleep(delayMs);
    latest = await inspectTransitionalState(input.input);
    if (latest.blockers.length === 0 && input.expected(latest)) return latest;
    if (latest.blockers.length > 0) break;
  }
  throw recoveryError(
    'Report Metric Values transitional recovery did not converge after one mutation',
    'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_VERIFY_FAILED',
    latest ? {
      blockers: latest.blockers,
      display: publicMigration(latest.display),
      window: publicMigration(latest.window),
      previousSignature: input.previousSignature,
      latestSignature: stateSignature(latest),
    } : {},
  );
}

async function writeCanonicalValues(client, tableId, updates, fieldName) {
  if (updates.length === 0) return;
  const result = await client.batchUpdateRecords({ tableId, records: updates });
  if (Number(result?.updated) !== updates.length) throw recoveryError(
    'Lark did not confirm every canonical Report Metric recovery write',
    'REPORT_METRIC_FIELD_MIGRATION_BATCH_COUNT_MISMATCH',
    { fieldName, expectedRows: updates.length, actualRows: result?.updated ?? null },
  );
}

function buildPublicPlan(inspected) {
  if (inspected.blockers.length > 0) return deepFreeze({
    ok: true,
    mode: 'preview',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    schemaVersion: inspected.schemaVersion,
    migrationCount: 0,
    pendingMigrationCount: 0,
    convergedMigrationCount: 0,
    notRequiredMigrationCount: 0,
    blockerCount: inspected.blockers.length,
    repairable: false,
    plannedFieldMutationCount: 0,
    plannedCanonicalValueWriteCount: 0,
    remoteMutationCount: 0,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    migrations: [],
    blockers: inspected.blockers,
  });
  const migrations = [publicMigration(inspected.display), publicMigration(inspected.window)];
  return deepFreeze({
    ok: true,
    mode: 'preview',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    schemaVersion: inspected.schemaVersion,
    migrationCount: migrations.length,
    pendingMigrationCount: migrations.filter((migration) => migration.pending).length,
    convergedMigrationCount: migrations.filter((migration) => migration.state === 'converged').length,
    notRequiredMigrationCount: migrations.filter((migration) => migration.state === 'not_required').length,
    blockerCount: 0,
    repairable: true,
    plannedFieldMutationCount: plannedWindowFieldMutationCount(inspected.window),
    plannedCanonicalValueWriteCount:
      inspected.display.pendingRecordCount + inspected.window.pendingRecordCount,
    remoteMutationCount: 0,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    migrations,
    blockers: [],
  });
}

function plannedWindowFieldMutationCount(window) {
  if (window.state === 'needs_archive_primary_legacy') return 3;
  if (window.state === 'needs_rename') return 2;
  if (window.state === 'needs_create') return 1;
  return 0;
}

function publicMigration(migration) {
  return deepFreeze({
    tableKey: TABLE_KEY,
    fieldName: migration.fieldName ?? null,
    legacyName: migration.legacyName ?? null,
    secondaryLegacyName: migration.secondaryLegacyName ?? null,
    sourceType: migration.sourceType ?? null,
    targetType: migration.targetType ?? null,
    conversion: migration.conversion ?? null,
    state: migration.state ?? null,
    nextStep: migration.nextStep ?? null,
    pending: migration.pending === true,
    recordCount: migration.recordCount ?? null,
    populatedSourceCount: migration.populatedSourceCount ?? null,
    pendingRecordCount: migration.pendingRecordCount ?? null,
    sourceFieldCount: migration.sourceFieldCount ?? null,
    sourceFingerprint: migration.sourceFingerprint ?? null,
    canonicalFingerprint: migration.canonicalFingerprint ?? null,
  });
}

function isRecoverableBasePlan(plan) {
  return Number(plan?.blockerCount ?? 0) > 0
    && Array.isArray(plan.blockers)
    && plan.blockers.every((blocker) => RECOVERABLE_BLOCKERS.has(blocker?.code));
}

function assertRecoveryRepairable(inspected) {
  if (inspected.blockers.length > 0) throw recoveryError(
    'Report Metric Values transitional state is outside the value-preserving recovery boundary',
    'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_BLOCKED',
    { blockerCount: inspected.blockers.length, blockers: inspected.blockers },
  );
}

function assertLegacyFingerprintsUnchanged(expected, actualEntries) {
  const actual = new Map(actualEntries);
  const mismatches = [];
  for (const [fieldId, fingerprintValue] of expected) {
    if (actual.get(fieldId) !== fingerprintValue) mismatches.push(fieldId);
  }
  if (mismatches.length > 0) throw recoveryError(
    'Legacy Report Metric values changed during transitional recovery',
    'REPORT_METRIC_FIELD_MIGRATION_SOURCE_CHANGED',
    { changedLegacyFieldCount: mismatches.length },
  );
}

function requireDesiredField(tableContract, contract) {
  const desired = tableContract.fields.find(
    (field) => normalizeName(field.fieldName) === normalizeName(contract.fieldName),
  );
  if (!desired || Number(desired.type) !== contract.targetType || desired.primary === true) {
    throw recoveryError(
      'Report Metric Values recovery target contract is invalid',
      'REPORT_METRIC_FIELD_MIGRATION_TARGET_CONTRACT_INVALID',
      {
        tableKey: TABLE_KEY,
        fieldName: contract.fieldName,
        expectedType: contract.targetType,
        actualType: desired?.type ?? null,
      },
    );
  }
  return desired;
}

function uniqueField(fields, fieldName) {
  const matches = fields.filter((field) => normalizeName(field.fieldName) === normalizeName(fieldName));
  if (matches.length > 1) return {
    field: null,
    blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_FIELD_AMBIGUOUS', {
      tableKey: TABLE_KEY,
      fieldName,
      fieldCount: matches.length,
    }),
  };
  const field = matches[0] ?? null;
  if (field?.isPrimary === true) return {
    field: null,
    blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_PRIMARY_FIELD_BLOCKED', {
      tableKey: TABLE_KEY,
      fieldName,
    }),
  };
  return { field, blocker: null };
}

function blockedInspection(schemaVersion, blockers) {
  return deepFreeze({
    schemaVersion,
    tableId: null,
    recordCount: 0,
    recoveryMarkerPresent: false,
    display: blockedMigration(DISPLAY_FIELD, blockers[0]),
    window: blockedMigration(WINDOW_FIELD, blockers[0]),
    blockers,
    legacyFieldFingerprints: Object.freeze([]),
  });
}

function blockedMigration(contract, blocker) {
  return deepFreeze({
    ...contract,
    state: 'blocked',
    nextStep: null,
    pending: false,
    recordCount: null,
    populatedSourceCount: null,
    pendingRecordCount: 0,
    sourceFieldCount: null,
    sourceFingerprint: null,
    canonicalFingerprint: null,
    pendingUpdates: Object.freeze([]),
    legacyFieldFingerprints: Object.freeze([]),
    blocker,
  });
}

function stateSignature(inspected) {
  return JSON.stringify({
    recordCount: inspected.recordCount,
    recoveryMarkerPresent: inspected.recoveryMarkerPresent,
    displayState: inspected.display.state,
    displayPending: inspected.display.pendingRecordCount,
    windowState: inspected.window.state,
    windowStep: inspected.window.nextStep,
    windowPending: inspected.window.pendingRecordCount,
    windowSourceFields: inspected.window.sourceFieldCount,
  });
}

function renameFieldMutation(field, fieldName) {
  return deepFreeze({
    fieldName,
    type: Number(field.type),
    ...(field.uiType ? { uiType: field.uiType } : {}),
    ...(field.description ? { description: field.description } : {}),
    ...(field.property ? { property: clone(field.property) } : {}),
  });
}

function convertWindowValue(text) {
  const normalized = text.trim();
  if (!/^(?:0|[1-9]\d*)$/u.test(normalized)) throw recoveryError(
    'Legacy window_days value is not an integer',
    'REPORT_METRIC_FIELD_MIGRATION_VALUE_NOT_LOSSLESS',
    { tableKey: TABLE_KEY, fieldName: WINDOW_FIELD.fieldName },
  );
  const number = Number(normalized);
  if (!Number.isSafeInteger(number)
    || String(number) !== normalized
    || !DASHBOARD_REPORT_PRESET_DAYS.includes(number)) {
    throw recoveryError(
      'Legacy window_days value is outside the canonical Report presets',
      'REPORT_METRIC_FIELD_MIGRATION_VALUE_NOT_LOSSLESS',
      { tableKey: TABLE_KEY, fieldName: WINDOW_FIELD.fieldName },
    );
  }
  return number;
}

function readSingleSelectValue(value) {
  if (Array.isArray(value) && value.length > 1) throw recoveryError(
    'Legacy SingleSelect contains multiple entries',
    'REPORT_METRIC_FIELD_MIGRATION_SOURCE_VALUE_INVALID',
  );
  return readLarkText(value, { allowNull: true, label: 'legacy SingleSelect' });
}

function readFieldValue(fields, fieldName) {
  const entry = Object.entries(fields ?? {}).find(
    ([name]) => normalizeName(name) === normalizeName(fieldName),
  );
  return entry?.[1] ?? null;
}

function sortedRecords(records) {
  return [...records].sort((left, right) => String(left?.recordId ?? '').localeCompare(String(right?.recordId ?? '')));
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeBlocker(code, details = {}) {
  return deepFreeze({ code, ...details });
}

function requireClient(client) {
  for (const method of [
    'listTables', 'listFields', 'listRecords', 'updateField', 'createField', 'batchUpdateRecords',
  ]) {
    if (typeof client?.[method] !== 'function') throw new TypeError(
      `Report Metric Values recovery requires client.${method}`,
    );
  }
  return client;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw recoveryError(
    `Report Metric Values recovery requires ${fieldName}`,
    'REPORT_METRIC_FIELD_MIGRATION_IDENTITY_INVALID',
  );
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

function sleepMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function recoveryError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

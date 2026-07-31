import { createHash } from 'node:crypto';
import { planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';
import { readLarkText } from '../../packages/connectors/src/shared/lark-cell-value.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration as applyRecoveryV2,
  planReportMetricValueFieldMigration as planRecoveryV2,
  safeReportMetricValueFieldMigrationEvidence,
} from './report-metric-value-field-migration-recovery.js';

export {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  safeReportMetricValueFieldMigrationEvidence,
};

export const REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION =
  'report_metric_value_field_migration_recovery_v3';

const TABLE_KEY = 'mktReportMetricValues';
const MAX_RECORDS = 500;
const VERIFY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);
const DISPLAY_FIELD = Object.freeze({
  fieldName: 'display_name',
  legacyName: '__mkt_legacy_display_name_single_select_v1',
  secondaryLegacyName: '__mkt_legacy_display_name_single_select_v2',
  sourceType: 3,
  targetType: 1,
  conversion: 'single_select_to_text',
});
const DISPLAY_UNSUPPORTED_CODE =
  'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_DISPLAY_STATE_UNSUPPORTED';

export async function planReportMetricValueFieldMigration(input = {}) {
  const v2Plan = await planRecoveryV2(input);
  const inspection = await inspectDisplayRecovery(input);
  if (!shouldUseDisplayRecovery(v2Plan, inspection)) return v2Plan;
  return buildCombinedPreview(input, inspection);
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

  const v2Plan = await planRecoveryV2(input);
  let inspection = await inspectDisplayRecovery(input);
  if (!shouldUseDisplayRecovery(v2Plan, inspection)) return applyRecoveryV2(input);
  assertDisplayRepairable(inspection);

  const client = requireClient(input.client);
  const sleep = input.sleepImpl ?? sleepMs;
  const initialRecordCount = inspection.recordCount;
  const initialSourceFingerprints = new Map(inspection.legacyFieldFingerprints);
  let displayFieldMutationCount = 0;
  let displayCanonicalValueWriteCount = 0;
  let displayRecordBatchWriteCount = 0;

  for (let phase = 1; phase <= 4; phase += 1) {
    if (!inspection.display.pending) break;
    const previousSignature = displayStateSignature(inspection);

    if (inspection.display.nextStep === 'archive_primary_legacy') {
      await client.updateField({
        tableId: inspection.tableId,
        fieldId: inspection.display.archiveField.fieldId,
        field: renameFieldMutation(
          inspection.display.archiveField,
          DISPLAY_FIELD.secondaryLegacyName,
        ),
      });
      displayFieldMutationCount += 1;
    } else if (inspection.display.nextStep === 'rename_canonical_source') {
      await client.updateField({
        tableId: inspection.tableId,
        fieldId: inspection.display.renameField.fieldId,
        field: renameFieldMutation(
          inspection.display.renameField,
          DISPLAY_FIELD.legacyName,
        ),
      });
      displayFieldMutationCount += 1;
    } else if (inspection.display.nextStep === 'create_canonical') {
      await client.createField({
        tableId: inspection.tableId,
        field: inspection.display.targetFieldContract,
      });
      displayFieldMutationCount += 1;
    } else if (inspection.display.nextStep === 'backfill_canonical') {
      const updates = inspection.display.pendingUpdates.map((update) => ({
        recordId: update.recordId,
        fields: { [DISPLAY_FIELD.fieldName]: update.value },
      }));
      await writeCanonicalValues(client, inspection.tableId, updates);
      displayCanonicalValueWriteCount += updates.length;
      displayRecordBatchWriteCount += 1;
    } else {
      throw recoveryError(
        'Report Metric display recovery reached an unsupported step',
        'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_STEP_INVALID',
        publicDisplayMigration(inspection.display),
      );
    }

    inspection = await waitForDisplayTransition({
      input,
      sleep,
      previousSignature,
    });
    assertDisplayRepairable(inspection);
  }

  if (inspection.display.pending) {
    throw recoveryError(
      'Report Metric display recovery exceeded its bounded phase count',
      'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_PHASE_BOUND_EXCEEDED',
      publicDisplayMigration(inspection.display),
    );
  }
  if (inspection.recordCount !== initialRecordCount) {
    throw recoveryError(
      'Report Metric Values record count changed during display recovery',
      'REPORT_METRIC_FIELD_MIGRATION_SOURCE_CHANGED',
      { expectedRecordCount: initialRecordCount, actualRecordCount: inspection.recordCount },
    );
  }
  assertSourceFingerprintsUnchanged(
    initialSourceFingerprints,
    inspection.legacyFieldFingerprints,
  );

  const v2Result = await applyRecoveryV2(input);
  const finalPlan = await planReportMetricValueFieldMigration(input);
  if (finalPlan.repairable !== true
    || Number(finalPlan.blockerCount) !== 0
    || Number(finalPlan.pendingMigrationCount) !== 0
    || Number(finalPlan.migrationCount) !== 2) {
    throw recoveryError(
      'Report Metric display recovery did not converge with the existing v2 migration',
      'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_POST_VERIFY_FAILED',
      {
        migrationCount: finalPlan.migrationCount ?? null,
        pendingMigrationCount: finalPlan.pendingMigrationCount ?? null,
        blockerCount: finalPlan.blockerCount ?? null,
        blockers: finalPlan.blockers ?? [],
      },
    );
  }

  const fieldMutationCount = displayFieldMutationCount
    + requireNonNegativeInteger(v2Result.fieldMutationCount, 'v2Result.fieldMutationCount');
  const canonicalValueWriteCount = displayCanonicalValueWriteCount
    + requireNonNegativeInteger(
      v2Result.canonicalValueWriteCount,
      'v2Result.canonicalValueWriteCount',
    );
  const recordBatchWriteCount = displayRecordBatchWriteCount
    + requireNonNegativeInteger(v2Result.recordBatchWriteCount, 'v2Result.recordBatchWriteCount');

  return deepFreeze({
    ...finalPlan,
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
    appliedMigrations: finalPlan.migrations,
  });
}

async function buildCombinedPreview(input, inspection) {
  if (inspection.blockers.length > 0) return blockedPlan(inspection);
  const simulatedClient = createConvergedDisplayClient(input.client, inspection);
  const postDisplayPlan = await planRecoveryV2({ ...input, client: simulatedClient });
  if (postDisplayPlan.repairable !== true || Number(postDisplayPlan.blockerCount) !== 0) {
    return deepFreeze({
      ...postDisplayPlan,
      contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    });
  }

  const windowMigration = postDisplayPlan.migrations.find(
    (migration) => migration.fieldName === 'window_days',
  );
  if (!windowMigration) {
    throw recoveryError(
      'Existing Report Metric recovery did not return window_days migration evidence',
      'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_POST_PREVIEW_INVALID',
    );
  }

  const migrations = Object.freeze([
    publicDisplayMigration(inspection.display),
    clone(windowMigration),
  ]);
  return deepFreeze({
    ok: true,
    mode: 'preview',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    schemaVersion: inspection.schemaVersion,
    migrationCount: 2,
    pendingMigrationCount: migrations.filter((migration) => migration.pending === true).length,
    convergedMigrationCount: migrations.filter(
      (migration) => migration.state === 'converged',
    ).length,
    notRequiredMigrationCount: migrations.filter(
      (migration) => migration.state === 'not_required',
    ).length,
    blockerCount: 0,
    repairable: true,
    plannedFieldMutationCount: plannedDisplayFieldMutationCount(inspection.display)
      + requireNonNegativeInteger(
        postDisplayPlan.plannedFieldMutationCount,
        'postDisplayPlan.plannedFieldMutationCount',
      ),
    plannedCanonicalValueWriteCount: inspection.display.pendingRecordCount
      + requireNonNegativeInteger(
        postDisplayPlan.plannedCanonicalValueWriteCount,
        'postDisplayPlan.plannedCanonicalValueWriteCount',
      ),
    remoteMutationCount: 0,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    migrations,
    blockers: [],
  });
}

async function inspectDisplayRecovery(input = {}) {
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
  const desired = requireDesiredDisplayField(tableContract);
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

  const display = inspectDisplayFields({ fields, records, desired });
  return deepFreeze({
    schemaVersion,
    tableId: resolution.tableId,
    recordCount: records.length,
    ownsState: display.ownsState === true,
    display,
    blockers: display.blocker ? Object.freeze([display.blocker]) : Object.freeze([]),
    legacyFieldFingerprints: display.legacyFieldFingerprints,
    rawFields: Object.freeze(fields.map(clone)),
    rawRecords: Object.freeze(records.map(clone)),
  });
}

function inspectDisplayFields(input) {
  const canonical = uniqueField(input.fields, DISPLAY_FIELD.fieldName);
  const primaryLegacy = uniqueField(input.fields, DISPLAY_FIELD.legacyName);
  const secondaryLegacy = uniqueField(input.fields, DISPLAY_FIELD.secondaryLegacyName);
  const ambiguity = canonical.blocker ?? primaryLegacy.blocker ?? secondaryLegacy.blocker;
  if (ambiguity) return blockedDisplay(ambiguity, true);

  for (const candidate of [primaryLegacy.field, secondaryLegacy.field].filter(Boolean)) {
    if (Number(candidate.type) !== DISPLAY_FIELD.sourceType) return blockedDisplay(
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_LEGACY_TYPE_INVALID', {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        expectedType: DISPLAY_FIELD.sourceType,
        actualType: candidate.type,
      }),
      true,
    );
  }

  let sourceFields = [primaryLegacy.field, secondaryLegacy.field].filter(Boolean);
  let targetField = null;
  let state;
  let nextStep = null;
  let archiveField = null;
  let renameField = null;
  let ownsState = sourceFields.length > 0;

  if (canonical.field && Number(canonical.field.type) === DISPLAY_FIELD.targetType) {
    targetField = canonical.field;
    state = sourceFields.length > 0 ? 'canonical_present' : 'not_required';
  } else if (canonical.field && Number(canonical.field.type) === DISPLAY_FIELD.sourceType) {
    ownsState = true;
    sourceFields = [canonical.field, ...sourceFields];
    if (primaryLegacy.field && secondaryLegacy.field) return blockedDisplay(
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_DISPLAY_ARCHIVE_AMBIGUOUS', {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        sourceFieldCount: sourceFields.length,
      }),
      true,
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
    ownsState = true;
    state = 'needs_create';
    nextStep = 'create_canonical';
  } else {
    return blockedDisplay(
      safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_DISPLAY_STATE_UNSUPPORTED', {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        canonicalType: canonical.field?.type ?? null,
        canonicalFieldCount: canonical.field ? 1 : 0,
        sourceFieldCount: sourceFields.length,
      }),
      false,
    );
  }

  const analysis = analyzeDisplayRecords({
    records: input.records,
    sourceFields,
    targetField,
  });
  if (analysis.blocker) return blockedDisplay(analysis.blocker, ownsState);
  if (state === 'canonical_present') {
    if (analysis.pendingUpdates.length > 0) {
      state = 'needs_backfill';
      nextStep = 'backfill_canonical';
    } else {
      state = sourceFields.length > 0 ? 'converged' : 'not_required';
    }
  }

  return deepFreeze({
    ...DISPLAY_FIELD,
    ownsState,
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
    sourceFields: Object.freeze(sourceFields.map(clone)),
    targetField: targetField ? clone(targetField) : null,
    archiveField: archiveField ? clone(archiveField) : null,
    renameField: renameField ? clone(renameField) : null,
    blocker: null,
  });
}

function analyzeDisplayRecords(input) {
  const mergedRows = [];
  const canonicalRows = [];
  const finalCanonicalValues = [];
  const valuesByFieldId = new Map(input.sourceFields.map((field) => [field.fieldId, []]));
  const pendingUpdates = [];
  let populatedSourceCount = 0;

  for (const record of sortedRecords(input.records)) {
    const recordId = requireText(record.recordId, 'recordId');
    const observed = [];
    for (const field of input.sourceFields) {
      const value = readSingleSelectValue(readFieldValue(record.fields, field.fieldName));
      valuesByFieldId.get(field.fieldId).push([recordId, value]);
      if (value !== null) observed.push(value);
    }
    const unique = [...new Set(observed)];
    if (unique.length > 1) return {
      blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT', {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        recordCount: input.records.length,
        sourceFieldCount: input.sourceFields.length,
      }),
    };
    const merged = unique[0] ?? null;
    if (merged !== null) populatedSourceCount += 1;
    const canonical = input.targetField
      ? readLarkText(readFieldValue(record.fields, input.targetField.fieldName), {
        allowNull: true,
        label: DISPLAY_FIELD.fieldName,
      })
      : null;
    if (merged !== null && canonical !== null && merged !== canonical) return {
      blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH', {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        recordCount: input.records.length,
      }),
    };
    const finalValue = canonical ?? merged;
    if (merged !== null && canonical === null && input.targetField) {
      pendingUpdates.push(deepFreeze({ recordId, value: merged }));
    }
    mergedRows.push([recordId, merged]);
    canonicalRows.push([recordId, canonical]);
    finalCanonicalValues.push([recordId, finalValue]);
  }

  return {
    populatedSourceCount,
    pendingUpdates: Object.freeze(pendingUpdates),
    sourceFingerprint: fingerprint(mergedRows),
    canonicalFingerprint: input.targetField ? fingerprint(canonicalRows) : null,
    finalCanonicalValues: Object.freeze(finalCanonicalValues),
    legacyFieldFingerprints: Object.freeze(
      [...valuesByFieldId.entries()].map(([fieldId, rows]) => [fieldId, fingerprint(rows)]),
    ),
  };
}

function createConvergedDisplayClient(client, inspection) {
  const display = inspection.display;
  const sourceNameByFieldId = finalSourceNames(display);
  const displayFieldIds = new Set([
    ...display.sourceFields.map((field) => field.fieldId),
    ...(display.targetField ? [display.targetField.fieldId] : []),
  ]);
  const finalValueByRecordId = new Map(
    analyzeDisplayRecords({
      records: inspection.rawRecords,
      sourceFields: display.sourceFields,
      targetField: display.targetField,
    }).finalCanonicalValues,
  );
  const desired = display.targetFieldContract;
  const fields = inspection.rawFields
    .filter((field) => !displayFieldIds.has(field.fieldId))
    .map(clone);

  for (const sourceField of display.sourceFields) {
    fields.push({
      ...clone(sourceField),
      fieldName: sourceNameByFieldId.get(sourceField.fieldId),
    });
  }
  fields.push(display.targetField
    ? { ...clone(display.targetField), fieldName: DISPLAY_FIELD.fieldName }
    : {
      fieldId: '__preview_display_text_canonical__',
      fieldName: DISPLAY_FIELD.fieldName,
      type: Number(desired.type),
      uiType: desired.uiType ?? 'Text',
      isPrimary: false,
      property: clone(desired.property ?? null),
      description: desired.description ?? '',
    });

  const records = inspection.rawRecords.map((record) => {
    const outputFields = {};
    for (const [name, value] of Object.entries(record.fields ?? {})) {
      const related = inspection.rawFields.find(
        (field) => normalizeName(field.fieldName) === normalizeName(name),
      );
      if (!related || !displayFieldIds.has(related.fieldId)) outputFields[name] = clone(value);
    }
    for (const sourceField of display.sourceFields) {
      outputFields[sourceNameByFieldId.get(sourceField.fieldId)] = clone(
        readFieldValue(record.fields, sourceField.fieldName),
      );
    }
    outputFields[DISPLAY_FIELD.fieldName] = finalValueByRecordId.get(record.recordId) ?? null;
    return { ...clone(record), fields: outputFields };
  });

  return Object.freeze({
    async listTables(args) { return client.listTables(args); },
    async listFields() { return fields.map(clone); },
    async listRecords() { return records.map(clone); },
    async updateField(args) { return client.updateField(args); },
    async createField(args) { return client.createField(args); },
    async batchUpdateRecords(args) { return client.batchUpdateRecords(args); },
  });
}

function finalSourceNames(display) {
  const result = new Map();
  const canonicalSource = display.sourceFields.find(
    (field) => normalizeName(field.fieldName) === normalizeName(DISPLAY_FIELD.fieldName),
  );
  const primarySource = display.sourceFields.find(
    (field) => normalizeName(field.fieldName) === normalizeName(DISPLAY_FIELD.legacyName),
  );
  const secondarySource = display.sourceFields.find(
    (field) => normalizeName(field.fieldName) === normalizeName(DISPLAY_FIELD.secondaryLegacyName),
  );

  if (canonicalSource) result.set(canonicalSource.fieldId, DISPLAY_FIELD.legacyName);
  if (primarySource) {
    result.set(
      primarySource.fieldId,
      canonicalSource ? DISPLAY_FIELD.secondaryLegacyName : DISPLAY_FIELD.legacyName,
    );
  }
  if (secondarySource) result.set(secondarySource.fieldId, DISPLAY_FIELD.secondaryLegacyName);
  return result;
}

function shouldUseDisplayRecovery(v2Plan, inspection) {
  if (inspection.ownsState === true) return true;
  return Array.isArray(v2Plan?.blockers)
    && v2Plan.blockers.some((blocker) => blocker?.code === DISPLAY_UNSUPPORTED_CODE);
}

function blockedPlan(inspection) {
  return deepFreeze({
    ok: true,
    mode: 'preview',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    schemaVersion: inspection.schemaVersion,
    migrationCount: 0,
    pendingMigrationCount: 0,
    convergedMigrationCount: 0,
    notRequiredMigrationCount: 0,
    blockerCount: inspection.blockers.length,
    repairable: false,
    plannedFieldMutationCount: 0,
    plannedCanonicalValueWriteCount: 0,
    remoteMutationCount: 0,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    migrations: [],
    blockers: inspection.blockers,
  });
}

function blockedInspection(schemaVersion, blockers) {
  return deepFreeze({
    schemaVersion,
    tableId: null,
    recordCount: 0,
    ownsState: false,
    display: blockedDisplay(blockers[0], false),
    blockers: Object.freeze(blockers),
    legacyFieldFingerprints: Object.freeze([]),
    rawFields: Object.freeze([]),
    rawRecords: Object.freeze([]),
  });
}

function blockedDisplay(blocker, ownsState) {
  return deepFreeze({
    ...DISPLAY_FIELD,
    ownsState,
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
    sourceFields: Object.freeze([]),
    targetField: null,
    archiveField: null,
    renameField: null,
    blocker,
  });
}

function publicDisplayMigration(display) {
  return deepFreeze({
    tableKey: TABLE_KEY,
    fieldName: DISPLAY_FIELD.fieldName,
    legacyName: DISPLAY_FIELD.legacyName,
    secondaryLegacyName: DISPLAY_FIELD.secondaryLegacyName,
    sourceType: DISPLAY_FIELD.sourceType,
    targetType: DISPLAY_FIELD.targetType,
    conversion: DISPLAY_FIELD.conversion,
    state: display.state,
    nextStep: display.nextStep,
    pending: display.pending === true,
    recordCount: display.recordCount,
    populatedSourceCount: display.populatedSourceCount,
    pendingRecordCount: display.pendingRecordCount,
    sourceFieldCount: display.sourceFieldCount,
    sourceFingerprint: display.sourceFingerprint,
    canonicalFingerprint: display.canonicalFingerprint,
  });
}

function plannedDisplayFieldMutationCount(display) {
  if (display.state === 'needs_archive_primary_legacy') return 3;
  if (display.state === 'needs_rename') return 2;
  if (display.state === 'needs_create') return 1;
  return 0;
}

async function waitForDisplayTransition(input) {
  let latest = null;
  for (const delayMs of VERIFY_DELAYS_MS) {
    if (delayMs > 0) await input.sleep(delayMs);
    latest = await inspectDisplayRecovery(input.input);
    if (latest.blockers.length === 0
      && displayStateSignature(latest) !== input.previousSignature) return latest;
    if (latest.blockers.length > 0) break;
  }
  throw recoveryError(
    'Report Metric display recovery did not converge after one mutation',
    'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_VERIFY_FAILED',
    latest ? {
      blockers: latest.blockers,
      display: publicDisplayMigration(latest.display),
      previousSignature: input.previousSignature,
      latestSignature: displayStateSignature(latest),
    } : {},
  );
}

async function writeCanonicalValues(client, tableId, updates) {
  if (updates.length === 0) return;
  const result = await client.batchUpdateRecords({ tableId, records: updates });
  if (Number(result?.updated) !== updates.length) throw recoveryError(
    'Lark did not confirm every canonical display recovery write',
    'REPORT_METRIC_FIELD_MIGRATION_BATCH_COUNT_MISMATCH',
    { fieldName: DISPLAY_FIELD.fieldName, expectedRows: updates.length, actualRows: result?.updated ?? null },
  );
}

function assertDisplayRepairable(inspection) {
  if (inspection.blockers.length > 0) throw recoveryError(
    'Report Metric display state is outside the value-preserving recovery boundary',
    'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_BLOCKED',
    { blockerCount: inspection.blockers.length, blockers: inspection.blockers },
  );
}

function assertSourceFingerprintsUnchanged(expected, actualEntries) {
  const actual = new Map(actualEntries);
  const mismatches = [];
  for (const [fieldId, expectedFingerprint] of expected) {
    if (actual.get(fieldId) !== expectedFingerprint) mismatches.push(fieldId);
  }
  if (mismatches.length > 0) throw recoveryError(
    'Legacy display values changed during recovery',
    'REPORT_METRIC_FIELD_MIGRATION_SOURCE_CHANGED',
    { changedLegacyFieldCount: mismatches.length },
  );
}

function requireDesiredDisplayField(tableContract) {
  const desired = tableContract.fields.find(
    (field) => normalizeName(field.fieldName) === normalizeName(DISPLAY_FIELD.fieldName),
  );
  if (!desired || Number(desired.type) !== DISPLAY_FIELD.targetType || desired.primary === true) {
    throw recoveryError(
      'Report Metric display recovery target contract is invalid',
      'REPORT_METRIC_FIELD_MIGRATION_TARGET_CONTRACT_INVALID',
      {
        tableKey: TABLE_KEY,
        fieldName: DISPLAY_FIELD.fieldName,
        expectedType: DISPLAY_FIELD.targetType,
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

function displayStateSignature(inspection) {
  return JSON.stringify({
    recordCount: inspection.recordCount,
    state: inspection.display.state,
    nextStep: inspection.display.nextStep,
    pendingRecordCount: inspection.display.pendingRecordCount,
    sourceFieldCount: inspection.display.sourceFieldCount,
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

function readSingleSelectValue(value) {
  if (Array.isArray(value) && value.length > 1) throw recoveryError(
    'Legacy display SingleSelect contains multiple entries',
    'REPORT_METRIC_FIELD_MIGRATION_SOURCE_VALUE_INVALID',
  );
  return readLarkText(value, { allowNull: true, label: 'legacy display SingleSelect' });
}

function readFieldValue(fields, fieldName) {
  const entry = Object.entries(fields ?? {}).find(
    ([name]) => normalizeName(name) === normalizeName(fieldName),
  );
  return entry?.[1] ?? null;
}

function sortedRecords(records) {
  return [...records].sort(
    (left, right) => String(left?.recordId ?? '').localeCompare(String(right?.recordId ?? '')),
  );
}

function requireClient(client) {
  for (const method of [
    'listTables', 'listFields', 'listRecords', 'updateField', 'createField', 'batchUpdateRecords',
  ]) {
    if (typeof client?.[method] !== 'function') throw new TypeError(
      `Report Metric display recovery requires client.${method}`,
    );
  }
  return client;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw recoveryError(
    `Report Metric display recovery requires ${fieldName}`,
    'REPORT_METRIC_FIELD_MIGRATION_IDENTITY_INVALID',
  );
  return value.trim();
}

function requireNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw recoveryError(
    `Report Metric display recovery requires non-negative ${fieldName}`,
    'REPORT_METRIC_FIELD_MIGRATION_RESULT_INVALID',
  );
  return number;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeBlocker(code, details = {}) {
  return deepFreeze({ code, ...details });
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

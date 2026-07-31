import { createHash } from 'node:crypto';
import { planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';
import { readLarkText } from '../../packages/connectors/src/shared/lark-cell-value.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

export const REPORT_METRIC_VALUE_FIELD_MIGRATION_VERSION =
  'report_metric_value_field_migration_v2';
export const REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION =
  'MIGRATE_REPORT_METRIC_VALUES_PRESERVE_LEGACY';

const TABLE_KEY = 'mktReportMetricValues';
const MAX_RECORDS = 500;
const VERIFY_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);

/**
 * display_name retains the historical lossless Select -> Text migration.
 * window_days remains visible in the plan only as a read-only ownership assertion so
 * existing Finalizer scope accounting stays exact. Dashboard field-identity recovery v3
 * is the only workflow allowed to promote the slicer-bound SingleSelect Field ID.
 */
const MIGRATIONS = Object.freeze([
  Object.freeze({
    fieldName: 'display_name',
    legacyName: '__mkt_legacy_display_name_single_select_v1',
    sourceType: 3,
    targetType: 1,
    conversion: 'single_select_to_text',
    ownershipOnly: false,
  }),
  Object.freeze({
    fieldName: 'window_days',
    legacyName: '__mkt_legacy_window_days_single_select_v1',
    sourceType: 3,
    targetType: 3,
    conversion: 'managed_by_field_identity_recovery_v3',
    ownershipOnly: true,
  }),
]);

export async function planReportMetricValueFieldMigration(input = {}) {
  const client = requireClient(input.client);
  const env = input.env ?? {};
  const schema = input.schema ?? LARK_REPORT_SCHEMA_V2;
  const schemaVersion = input.schemaVersion ?? LARK_REPORT_SCHEMA_V2_VERSION;
  const validateSchema = input.validateSchema ?? validateReportSchemaV2;
  validateSchema(schema);

  const tableContract = schema.find((table) => table.key === TABLE_KEY);
  if (!tableContract) {
    throw migrationError(
      'Report Metric Values table contract is missing',
      'REPORT_METRIC_FIELD_MIGRATION_CONTRACT_MISSING',
    );
  }

  const schemaPreview = await planLarkSchema({
    client,
    env,
    schema,
    schemaVersion,
    validateSchema,
  });
  const resolution = schemaPreview.resolvedTables.find((table) => table.tableKey === TABLE_KEY);
  if (!resolution?.tableId) {
    return freezePlan({
      schemaVersion,
      migrations: [],
      blockers: [safeBlocker('REPORT_METRIC_FIELD_MIGRATION_TABLE_UNRESOLVED')],
    });
  }

  const fields = await client.listFields({ tableId: resolution.tableId });
  const records = await client.listRecords({
    tableId: resolution.tableId,
    includeRecordMetadata: false,
  });
  if (records.length > MAX_RECORDS) {
    return freezePlan({
      schemaVersion,
      migrations: [],
      blockers: [safeBlocker('REPORT_METRIC_FIELD_MIGRATION_RECORD_BOUND_EXCEEDED', {
        recordCount: records.length,
        maxRecords: MAX_RECORDS,
      })],
    });
  }

  const migrations = [];
  const blockers = [];
  for (const contract of MIGRATIONS) {
    const desired = tableContract.fields.find(
      (field) => normalizeName(field.fieldName) === normalizeName(contract.fieldName),
    );
    if (!desired || Number(desired.type) !== contract.targetType || desired.primary === true) {
      blockers.push(safeBlocker('REPORT_METRIC_FIELD_MIGRATION_TARGET_CONTRACT_INVALID', {
        tableKey: TABLE_KEY,
        fieldName: contract.fieldName,
        expectedType: contract.targetType,
        actualType: desired?.type ?? null,
      }));
      continue;
    }

    const result = contract.ownershipOnly === true
      ? analyzeOwnershipAssertion({
        contract,
        desired,
        tableId: resolution.tableId,
        fields,
        records,
      })
      : analyzeMigrationField({
        contract,
        desired,
        tableId: resolution.tableId,
        fields,
        records,
      });
    if (result.blocker) blockers.push(result.blocker);
    else migrations.push(result.migration);
  }

  return freezePlan({ schemaVersion, migrations, blockers });
}

export async function applyReportMetricValueFieldMigration(input = {}) {
  const env = input.env ?? {};
  if (env.CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION
    !== REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION) {
    throw migrationError(
      `Apply requires CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION=${REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION}`,
      'REPORT_METRIC_FIELD_MIGRATION_CONFIRMATION_REQUIRED',
    );
  }

  const client = requireClient(input.client);
  const options = {
    client,
    env,
    schema: input.schema,
    schemaVersion: input.schemaVersion,
    validateSchema: input.validateSchema,
  };
  const sleep = input.sleepImpl ?? sleepMs;
  let plan = await planReportMetricValueFieldMigration(options);
  assertRepairablePlan(plan);

  let fieldMutationCount = 0;
  let canonicalValueWriteCount = 0;
  let recordBatchWriteCount = 0;
  const appliedMigrations = [];

  for (const initial of plan.migrations.filter((migration) => migration.pending === true)) {
    const result = await applyOneMigration({
      ...options,
      fieldName: initial.fieldName,
      sourceFingerprint: initial.sourceFingerprint,
      recordCount: initial.recordCount,
      sleep,
    });
    fieldMutationCount += result.fieldMutationCount;
    canonicalValueWriteCount += result.canonicalValueWriteCount;
    recordBatchWriteCount += result.recordBatchWriteCount;
    appliedMigrations.push(result.summary);
  }

  plan = await planReportMetricValueFieldMigration(options);
  assertRepairablePlan(plan);
  if (plan.pendingMigrationCount !== 0) {
    throw migrationError(
      'Report Metric Values field migration did not converge',
      'REPORT_METRIC_FIELD_MIGRATION_POST_VERIFY_FAILED',
      {
        pendingMigrationCount: plan.pendingMigrationCount,
        blockers: plan.blockers,
      },
    );
  }

  return deepFreeze({
    ok: true,
    mode: 'apply',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_VERSION,
    schemaVersion: plan.schemaVersion,
    migrationCount: plan.migrationCount,
    convergedMigrationCount: plan.convergedMigrationCount,
    notRequiredMigrationCount: plan.notRequiredMigrationCount,
    pendingMigrationCount: 0,
    blockerCount: 0,
    fieldMutationCount,
    canonicalValueWriteCount,
    recordBatchWriteCount,
    remoteMutationCount: fieldMutationCount + recordBatchWriteCount,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    appliedMigrations,
    migrations: plan.migrations,
  });
}

async function applyOneMigration(input) {
  let fieldMutationCount = 0;
  let canonicalValueWriteCount = 0;
  let recordBatchWriteCount = 0;
  let latest = await readMigration(input, input.fieldName);
  assertStableSource(latest, input);

  for (let phase = 1; phase <= 4; phase += 1) {
    if (latest.state === 'converged' || latest.state === 'not_required') break;

    if (latest.nextStep === 'rename_legacy') {
      await input.client.updateField({
        tableId: latest.tableId,
        fieldId: latest.sourceField.fieldId,
        field: renameFieldMutation(latest.sourceField, latest.legacyName),
      });
      fieldMutationCount += 1;
    } else if (latest.nextStep === 'create_canonical') {
      await input.client.createField({
        tableId: latest.tableId,
        field: latest.targetFieldContract,
      });
      fieldMutationCount += 1;
    } else if (latest.nextStep === 'backfill_canonical') {
      const updates = latest.pendingUpdates.map((update) => ({
        recordId: update.recordId,
        fields: { [latest.fieldName]: update.value },
      }));
      const result = await input.client.batchUpdateRecords({
        tableId: latest.tableId,
        records: updates,
      });
      if (Number(result?.updated) !== updates.length) {
        throw migrationError(
          'Lark did not confirm every canonical Report Metric value write',
          'REPORT_METRIC_FIELD_MIGRATION_BATCH_COUNT_MISMATCH',
          {
            fieldName: latest.fieldName,
            expectedRows: updates.length,
            actualRows: result?.updated ?? null,
          },
        );
      }
      canonicalValueWriteCount += updates.length;
      recordBatchWriteCount += updates.length > 0 ? 1 : 0;
      latest = await verifyMigrationAfterWrite(input, latest.fieldName, input.sleep);
      assertStableSource(latest, input);
      break;
    } else {
      throw migrationError(
        'Report Metric Values migration reached an unsupported state',
        'REPORT_METRIC_FIELD_MIGRATION_STATE_INVALID',
        safeMigration(latest),
      );
    }

    latest = await readMigration(input, input.fieldName);
    assertStableSource(latest, input);
  }

  if (latest.state !== 'converged' && latest.state !== 'not_required') {
    throw migrationError(
      'Report Metric Values migration exceeded its bounded phase count',
      'REPORT_METRIC_FIELD_MIGRATION_PHASE_BOUND_EXCEEDED',
      safeMigration(latest),
    );
  }

  return deepFreeze({
    fieldMutationCount,
    canonicalValueWriteCount,
    recordBatchWriteCount,
    summary: safeMigration(latest),
  });
}

async function verifyMigrationAfterWrite(input, fieldName, sleep) {
  let latest = null;
  for (const delayMs of VERIFY_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    latest = await readMigration(input, fieldName);
    if (latest.state === 'converged') return latest;
  }
  throw migrationError(
    'Canonical Report Metric values did not converge after one write',
    'REPORT_METRIC_FIELD_MIGRATION_VALUE_VERIFY_FAILED',
    latest ? safeMigration(latest) : { fieldName },
  );
}

async function readMigration(input, fieldName) {
  const plan = await planReportMetricValueFieldMigration({
    client: input.client,
    env: input.env,
    schema: input.schema,
    schemaVersion: input.schemaVersion,
    validateSchema: input.validateSchema,
  });
  assertRepairablePlan(plan);
  const migration = plan.migrations.find((item) => item.fieldName === fieldName);
  if (!migration) {
    throw migrationError(
      'Report Metric Values migration field disappeared from the plan',
      'REPORT_METRIC_FIELD_MIGRATION_SCOPE_CHANGED',
      { fieldName },
    );
  }
  return migration;
}

function analyzeOwnershipAssertion(input) {
  const canonicalMatches = input.fields.filter(
    (field) => normalizeName(field.fieldName) === normalizeName(input.contract.fieldName),
  );
  const legacyMatches = input.fields.filter(
    (field) => normalizeName(field.fieldName) === normalizeName(input.contract.legacyName),
  );
  const canonical = canonicalMatches[0] ?? null;
  if (canonicalMatches.length === 1
    && legacyMatches.length === 0
    && canonical?.isPrimary !== true
    && Number(canonical?.type) === input.contract.targetType) {
    return {
      migration: buildNotRequiredMigration(input, canonical),
    };
  }
  return {
    blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_WINDOW_OWNERSHIP_NOT_CONVERGED', {
      tableKey: TABLE_KEY,
      fieldName: input.contract.fieldName,
      expectedType: input.contract.targetType,
      canonicalFieldCount: canonicalMatches.length,
      canonicalType: canonical?.type ?? null,
      legacyFieldCount: legacyMatches.length,
      recoveryContract: 'lark_dashboard_field_identity_recovery_v3',
    }),
  };
}

function analyzeMigrationField(input) {
  const canonicalMatches = input.fields.filter(
    (field) => normalizeName(field.fieldName) === normalizeName(input.contract.fieldName),
  );
  const legacyMatches = input.fields.filter(
    (field) => normalizeName(field.fieldName) === normalizeName(input.contract.legacyName),
  );
  if (canonicalMatches.length > 1 || legacyMatches.length > 1) {
    return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_FIELD_AMBIGUOUS', {
      tableKey: TABLE_KEY,
      fieldName: input.contract.fieldName,
      canonicalFieldCount: canonicalMatches.length,
      legacyFieldCount: legacyMatches.length,
    }) };
  }

  const canonical = canonicalMatches[0] ?? null;
  const legacy = legacyMatches[0] ?? null;
  if (canonical?.isPrimary === true || legacy?.isPrimary === true) {
    return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_PRIMARY_FIELD_BLOCKED', {
      tableKey: TABLE_KEY,
      fieldName: input.contract.fieldName,
    }) };
  }
  if (legacy && Number(legacy.type) !== input.contract.sourceType) {
    return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_LEGACY_TYPE_INVALID', {
      tableKey: TABLE_KEY,
      fieldName: input.contract.fieldName,
      expectedType: input.contract.sourceType,
      actualType: legacy.type,
    }) };
  }

  let state;
  let nextStep = null;
  let sourceField = null;
  let targetField = null;
  if (canonical && Number(canonical.type) === input.contract.sourceType && !legacy) {
    state = 'needs_rename';
    nextStep = 'rename_legacy';
    sourceField = canonical;
  } else if (!canonical && legacy) {
    state = 'needs_create';
    nextStep = 'create_canonical';
    sourceField = legacy;
  } else if (canonical && Number(canonical.type) === input.contract.targetType && legacy) {
    state = 'canonical_present';
    sourceField = legacy;
    targetField = canonical;
  } else if (canonical && Number(canonical.type) === input.contract.targetType && !legacy) {
    return { migration: buildNotRequiredMigration(input, canonical) };
  } else {
    return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_STATE_UNSUPPORTED', {
      tableKey: TABLE_KEY,
      fieldName: input.contract.fieldName,
      canonicalType: canonical?.type ?? null,
      legacyType: legacy?.type ?? null,
      canonicalFieldCount: canonicalMatches.length,
      legacyFieldCount: legacyMatches.length,
    }) };
  }

  const analysis = analyzeRecordValues({
    records: input.records,
    sourceField,
    targetField,
  });
  if (analysis.blocker) return { blocker: analysis.blocker };

  if (state === 'canonical_present') {
    if (analysis.pendingUpdates.length === 0) {
      state = 'converged';
    } else {
      state = 'needs_backfill';
      nextStep = 'backfill_canonical';
    }
  }

  return { migration: deepFreeze({
    tableKey: TABLE_KEY,
    tableId: input.tableId,
    fieldName: input.contract.fieldName,
    legacyName: input.contract.legacyName,
    sourceType: input.contract.sourceType,
    targetType: input.contract.targetType,
    conversion: input.contract.conversion,
    state,
    nextStep,
    pending: !['converged', 'not_required'].includes(state),
    recordCount: input.records.length,
    populatedSourceCount: analysis.populatedSourceCount,
    pendingRecordCount: analysis.pendingUpdates.length,
    sourceFingerprint: analysis.sourceFingerprint,
    canonicalFingerprint: analysis.canonicalFingerprint,
    sourceField,
    targetField,
    targetFieldContract: clone(input.desired),
    pendingUpdates: analysis.pendingUpdates,
  }) };
}

function analyzeRecordValues(input) {
  const sourceRows = [];
  const canonicalRows = [];
  const pendingUpdates = [];
  let populatedSourceCount = 0;

  for (const record of [...input.records].sort(compareRecordId)) {
    const recordId = requireText(record?.recordId, 'recordId');
    let sourceText;
    try {
      sourceText = readSingleSelectValue(readFieldValue(record.fields, input.sourceField.fieldName));
    } catch {
      return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_SOURCE_VALUE_INVALID', {
        tableKey: TABLE_KEY,
        fieldName: 'display_name',
        recordCount: input.records.length,
      }) };
    }

    if (sourceText !== null) populatedSourceCount += 1;
    const canonicalValue = input.targetField
      ? readTextValue(readFieldValue(record.fields, input.targetField.fieldName))
      : null;
    if (sourceText === null && canonicalValue !== null) {
      return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_CANONICAL_WITHOUT_SOURCE', {
        tableKey: TABLE_KEY,
        fieldName: 'display_name',
        recordCount: input.records.length,
      }) };
    }
    if (sourceText !== null && canonicalValue !== null && canonicalValue !== sourceText) {
      return { blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH', {
        tableKey: TABLE_KEY,
        fieldName: 'display_name',
        recordCount: input.records.length,
      }) };
    }
    if (sourceText !== null && canonicalValue === null) {
      pendingUpdates.push(deepFreeze({ recordId, value: sourceText }));
    }

    sourceRows.push([recordId, sourceText]);
    canonicalRows.push([recordId, canonicalValue]);
  }

  return {
    populatedSourceCount,
    pendingUpdates: Object.freeze(pendingUpdates),
    sourceFingerprint: fingerprint(sourceRows),
    canonicalFingerprint: fingerprint(canonicalRows),
  };
}

function buildNotRequiredMigration(input, canonical) {
  return deepFreeze({
    tableKey: TABLE_KEY,
    tableId: input.tableId,
    fieldName: input.contract.fieldName,
    legacyName: input.contract.legacyName,
    sourceType: input.contract.sourceType,
    targetType: input.contract.targetType,
    conversion: input.contract.conversion,
    state: 'not_required',
    nextStep: null,
    pending: false,
    recordCount: input.records.length,
    populatedSourceCount: 0,
    pendingRecordCount: 0,
    sourceFingerprint: null,
    canonicalFingerprint: null,
    sourceField: null,
    targetField: canonical,
    targetFieldContract: clone(input.desired),
    pendingUpdates: Object.freeze([]),
  });
}

function freezePlan(input) {
  const migrations = input.migrations ?? [];
  const blockers = input.blockers ?? [];
  return deepFreeze({
    ok: true,
    mode: 'preview',
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_VERSION,
    schemaVersion: input.schemaVersion,
    migrationCount: migrations.length,
    pendingMigrationCount: migrations.filter((migration) => migration.pending === true).length,
    convergedMigrationCount: migrations.filter((migration) => migration.state === 'converged').length,
    notRequiredMigrationCount: migrations.filter((migration) => migration.state === 'not_required').length,
    blockerCount: blockers.length,
    repairable: blockers.length === 0,
    plannedFieldMutationCount: migrations.reduce((sum, migration) => {
      if (migration.nextStep === 'rename_legacy') return sum + 2;
      if (migration.nextStep === 'create_canonical') return sum + 1;
      return sum;
    }, 0),
    plannedCanonicalValueWriteCount: migrations.reduce(
      (sum, migration) => sum + migration.pendingRecordCount,
      0,
    ),
    remoteMutationCount: 0,
    legacyValueMutationCount: 0,
    deleteCount: 0,
    migrations,
    blockers,
  });
}

function assertRepairablePlan(plan) {
  if (plan.repairable !== true || plan.blockerCount !== 0) {
    throw migrationError(
      'Report Metric Values fields cannot be migrated without preserving every legacy value',
      'REPORT_METRIC_FIELD_MIGRATION_BLOCKED',
      {
        pendingMigrationCount: plan.pendingMigrationCount,
        blockerCount: plan.blockerCount,
        blockers: plan.blockers,
      },
    );
  }
}

function assertStableSource(migration, input) {
  if (migration.recordCount !== input.recordCount
    || (migration.sourceFingerprint !== null
      && migration.sourceFingerprint !== input.sourceFingerprint)) {
    throw migrationError(
      'Legacy Report Metric values changed during migration',
      'REPORT_METRIC_FIELD_MIGRATION_SOURCE_CHANGED',
      {
        fieldName: migration.fieldName,
        expectedRecordCount: input.recordCount,
        actualRecordCount: migration.recordCount,
        expectedSourceFingerprint: input.sourceFingerprint,
        actualSourceFingerprint: migration.sourceFingerprint,
      },
    );
  }
}

export function safeReportMetricValueFieldMigrationEvidence(value) {
  if (Array.isArray(value)) return value.map(safeReportMetricValueFieldMigrationEvidence);
  if (!value || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'fieldName') && Object.hasOwn(value, 'state')) return safeMigration(value);
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/(?:token|secret|authorization|cookie|password|consumer_key|consumer_secret|tableId|fieldId|recordId)/iu.test(key)) continue;
    if (['sourceField', 'targetField', 'targetFieldContract', 'pendingUpdates'].includes(key)) continue;
    output[key] = safeReportMetricValueFieldMigrationEvidence(nested);
  }
  return output;
}

function safeMigration(migration) {
  return deepFreeze({
    tableKey: migration.tableKey ?? TABLE_KEY,
    fieldName: migration.fieldName ?? null,
    legacyName: migration.legacyName ?? null,
    sourceType: migration.sourceType ?? null,
    targetType: migration.targetType ?? null,
    conversion: migration.conversion ?? null,
    state: migration.state ?? null,
    nextStep: migration.nextStep ?? null,
    pending: migration.pending === true,
    recordCount: migration.recordCount ?? null,
    populatedSourceCount: migration.populatedSourceCount ?? null,
    pendingRecordCount: migration.pendingRecordCount ?? null,
    sourceFingerprint: migration.sourceFingerprint ?? null,
    canonicalFingerprint: migration.canonicalFingerprint ?? null,
  });
}

function safeBlocker(code, details = {}) {
  return deepFreeze({ code, ...details });
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
  if (Array.isArray(value) && value.length > 1) {
    throw new TypeError('SingleSelect value contains multiple entries');
  }
  return readLarkText(value, { allowNull: true, label: 'legacy SingleSelect' });
}

function readTextValue(value) {
  return readLarkText(value, { allowNull: true, label: 'display_name' });
}

function readFieldValue(fields, fieldName) {
  const entry = Object.entries(fields ?? {}).find(
    ([name]) => normalizeName(name) === normalizeName(fieldName),
  );
  return entry?.[1] ?? null;
}

function compareRecordId(left, right) {
  return String(left?.recordId ?? '').localeCompare(String(right?.recordId ?? ''));
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function requireClient(client) {
  for (const method of [
    'listTables', 'listFields', 'listRecords', 'updateField', 'createField', 'batchUpdateRecords',
  ]) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`Report Metric Values migration requires client.${method}`);
    }
  }
  return client;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw migrationError(
      `Report Metric Values migration requires ${fieldName}`,
      'REPORT_METRIC_FIELD_MIGRATION_IDENTITY_INVALID',
    );
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

function sleepMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function migrationError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

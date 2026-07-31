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
  applyReportMetricValueFieldMigration as applyRecoveryV3,
  planReportMetricValueFieldMigration as planRecoveryV3,
  safeReportMetricValueFieldMigrationEvidence as safeRecoveryV3Evidence,
} from './report-metric-value-field-migration-recovery-v3.js';

export { REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION };

export const REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION =
  'report_metric_value_field_migration_recovery_v4';

const TABLE_KEY = 'mktReportMetricValues';
const MAX_RECORDS = 500;
const CANONICAL_FIELD_NAME = 'display_name';
const LEGACY_FIELD_NAMES = Object.freeze([
  '__mkt_legacy_display_name_single_select_v1',
  '__mkt_legacy_display_name_single_select_v2',
]);
const CANONICAL_MISMATCH_CODE =
  'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH';

/**
 * หลัง migration สร้าง canonical Text สำเร็จแล้ว ค่าใน deterministic Legacy fields เป็น archive
 * เท่านั้น Report runtime จึงแก้ canonical display_name ได้โดยไม่ต้องแก้ค่า archive เดิม
 */
export async function planReportMetricValueFieldMigration(input = {}) {
  const v3Plan = await planRecoveryV3(input);
  if (!isExactPostMigrationCanonicalMismatch(v3Plan)) return v3Plan;

  const before = await inspectCanonicalAuthorityState(input);
  if (before.blockers.length > 0) return blockedPlan(before);
  assertCanonicalAuthorityState(before);

  const canonicalClient = createCanonicalAuthoritativeReadClient(input.client, before);
  const recoveredPlan = await planRecoveryV3({ ...input, client: canonicalClient });
  const after = await inspectCanonicalAuthorityState(input);
  if (before.stateFingerprint !== after.stateFingerprint) return blockedPlan({
    ...after,
    blockers: Object.freeze([safeBlocker(
      'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_STATE_CHANGED',
      { recordCount: after.recordCount },
    )]),
  });
  if (recoveredPlan.repairable !== true || Number(recoveredPlan.blockerCount) !== 0) {
    return deepFreeze({
      ...recoveredPlan,
      contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    });
  }
  return augmentResult(recoveredPlan, after);
}

export async function applyReportMetricValueFieldMigration(input = {}) {
  const v3Plan = await planRecoveryV3(input);
  if (!isExactPostMigrationCanonicalMismatch(v3Plan)) return applyRecoveryV3(input);

  const before = await inspectCanonicalAuthorityState(input);
  assertCanonicalAuthorityState(before);
  const expectedLegacyFingerprints = new Map(before.legacyFieldFingerprints);
  const canonicalClient = createCanonicalAuthoritativeReadClient(input.client, before);
  const result = await applyRecoveryV3({ ...input, client: canonicalClient });
  const after = await inspectCanonicalAuthorityState(input);

  if (after.blockers.length > 0 || after.recordCount !== before.recordCount) {
    throw recoveryError(
      'Report Metric canonical-authority recovery changed its bounded source state',
      'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_SOURCE_CHANGED',
      {
        expectedRecordCount: before.recordCount,
        actualRecordCount: after.recordCount,
        blockerCount: after.blockers.length,
        blockers: after.blockers,
      },
    );
  }
  assertLegacyFingerprintsUnchanged(expectedLegacyFingerprints, after.legacyFieldFingerprints);
  return augmentResult(result, after);
}

export function safeReportMetricValueFieldMigrationEvidence(value) {
  return safeRecoveryV3Evidence(value);
}

async function inspectCanonicalAuthorityState(input = {}) {
  const client = requireClient(input.client);
  const env = input.env ?? {};
  const schema = input.schema ?? LARK_REPORT_SCHEMA_V2;
  const schemaVersion = input.schemaVersion ?? LARK_REPORT_SCHEMA_V2_VERSION;
  const validateSchema = input.validateSchema ?? validateReportSchemaV2;
  validateSchema(schema);

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

  const canonical = uniqueField(fields, CANONICAL_FIELD_NAME);
  if (canonical.blocker) return blockedInspection(schemaVersion, [canonical.blocker]);
  if (!canonical.field || Number(canonical.field.type) !== 1 || canonical.field.isPrimary === true) {
    return blockedInspection(schemaVersion, [safeBlocker(
      'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_FIELD_INVALID',
      {
        canonicalFieldCount: canonical.field ? 1 : 0,
        canonicalType: canonical.field?.type ?? null,
      },
    )]);
  }

  const legacyFields = [];
  for (const fieldName of LEGACY_FIELD_NAMES) {
    const candidate = uniqueField(fields, fieldName);
    if (candidate.blocker) return blockedInspection(schemaVersion, [candidate.blocker]);
    if (!candidate.field) continue;
    if (Number(candidate.field.type) !== 3 || candidate.field.isPrimary === true) {
      return blockedInspection(schemaVersion, [safeBlocker(
        'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_LEGACY_FIELD_INVALID',
        { fieldName, actualType: candidate.field.type },
      )]);
    }
    legacyFields.push(candidate.field);
  }
  if (legacyFields.length === 0) return blockedInspection(schemaVersion, [safeBlocker(
    'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_LEGACY_MARKER_MISSING',
  )]);

  const legacyRowsByFieldId = new Map(legacyFields.map((field) => [field.fieldId, []]));
  const stateRows = [];
  let canonicalPopulatedCount = 0;
  let legacyPopulatedCount = 0;
  let canonicalOnlyRecordCount = 0;
  let divergenceCount = 0;
  let pendingBackfillCount = 0;

  for (const record of sortedRecords(records)) {
    const recordId = requireText(record.recordId, 'recordId');
    const observedLegacy = [];
    for (const field of legacyFields) {
      let value;
      try {
        value = readSingleSelectValue(readFieldValue(record.fields, field.fieldName));
      } catch {
        return blockedInspection(schemaVersion, [safeBlocker(
          'REPORT_METRIC_FIELD_MIGRATION_SOURCE_VALUE_INVALID',
          { recordCount: records.length },
        )]);
      }
      legacyRowsByFieldId.get(field.fieldId).push([recordId, value]);
      if (value !== null) observedLegacy.push(value);
    }
    const uniqueLegacy = [...new Set(observedLegacy)];
    if (uniqueLegacy.length > 1) return blockedInspection(schemaVersion, [safeBlocker(
      'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT',
      { recordCount: records.length, sourceFieldCount: legacyFields.length },
    )]);

    const legacyValue = uniqueLegacy[0] ?? null;
    const canonicalValue = readLarkText(
      readFieldValue(record.fields, canonical.field.fieldName),
      { allowNull: true, label: CANONICAL_FIELD_NAME },
    );
    if (legacyValue !== null) legacyPopulatedCount += 1;
    if (canonicalValue !== null) canonicalPopulatedCount += 1;
    if (legacyValue === null && canonicalValue !== null) canonicalOnlyRecordCount += 1;
    if (legacyValue !== null && canonicalValue === null) pendingBackfillCount += 1;
    if (legacyValue !== null && canonicalValue !== null && legacyValue !== canonicalValue) {
      divergenceCount += 1;
    }
    stateRows.push([recordId, canonicalValue, ...legacyFields.map(
      (field) => readSingleSelectValue(readFieldValue(record.fields, field.fieldName)),
    )]);
  }

  return deepFreeze({
    schemaVersion,
    tableId: resolution.tableId,
    recordCount: records.length,
    canonicalField: clone(canonical.field),
    legacyFields: Object.freeze(legacyFields.map(clone)),
    canonicalPopulatedCount,
    legacyPopulatedCount,
    canonicalOnlyRecordCount,
    divergenceCount,
    pendingBackfillCount,
    stateFingerprint: fingerprint(stateRows),
    legacyFieldFingerprints: Object.freeze(
      [...legacyRowsByFieldId.entries()].map(([fieldId, rows]) => [fieldId, fingerprint(rows)]),
    ),
    blockers: Object.freeze([]),
  });
}

function createCanonicalAuthoritativeReadClient(client, inspection) {
  const canonicalName = inspection.canonicalField.fieldName;
  const legacyNames = inspection.legacyFields.map((field) => field.fieldName);
  return Object.freeze({
    async listTables(args) { return client.listTables(args); },
    async listFields(args) { return client.listFields(args); },
    async listRecords(args) {
      const records = await client.listRecords(args);
      return records.map((record) => {
        const output = clone(record);
        const canonicalValue = readLarkText(
          readFieldValue(output.fields, canonicalName),
          { allowNull: true, label: CANONICAL_FIELD_NAME },
        );
        if (canonicalValue !== null) {
          for (const legacyName of legacyNames) setFieldValue(output.fields, legacyName, null);
        }
        return output;
      });
    },
    async updateField(args) { return client.updateField(args); },
    async createField(args) { return client.createField(args); },
    async batchUpdateRecords(args) { return client.batchUpdateRecords(args); },
  });
}

function isExactPostMigrationCanonicalMismatch(plan) {
  return plan?.repairable === false
    && Number(plan?.blockerCount) === 1
    && Array.isArray(plan?.blockers)
    && plan.blockers[0]?.code === CANONICAL_MISMATCH_CODE
    && plan.blockers[0]?.fieldName === CANONICAL_FIELD_NAME;
}

function assertCanonicalAuthorityState(inspection) {
  if (inspection.blockers.length > 0 || inspection.divergenceCount <= 0) {
    throw recoveryError(
      'Report Metric canonical-authority state is outside the reviewed post-migration boundary',
      'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_BLOCKED',
      {
        recordCount: inspection.recordCount,
        divergenceCount: inspection.divergenceCount,
        blockerCount: inspection.blockers.length,
        blockers: inspection.blockers,
      },
    );
  }
}

function assertLegacyFingerprintsUnchanged(expected, actualEntries) {
  const actual = new Map(actualEntries);
  let mismatchCount = 0;
  for (const [fieldId, expectedFingerprint] of expected) {
    if (actual.get(fieldId) !== expectedFingerprint) mismatchCount += 1;
  }
  if (mismatchCount > 0 || actual.size !== expected.size) throw recoveryError(
    'Archived Report Metric display values changed during canonical-authority recovery',
    'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_AUTHORITY_LEGACY_CHANGED',
    { changedLegacyFieldCount: mismatchCount, expectedLegacyFieldCount: expected.size, actualLegacyFieldCount: actual.size },
  );
}

function augmentResult(result, inspection) {
  return deepFreeze({
    ...result,
    contractVersion: REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
    canonicalAuthority: 'display_name_text',
    canonicalAuthoritativeDivergenceCount: inspection.divergenceCount,
    canonicalOnlyRecordCount: inspection.canonicalOnlyRecordCount,
    legacyBackfillRecordCount: inspection.pendingBackfillCount,
    legacyValueMutationCount: 0,
    deleteCount: 0,
  });
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
    canonicalField: null,
    legacyFields: Object.freeze([]),
    canonicalPopulatedCount: 0,
    legacyPopulatedCount: 0,
    canonicalOnlyRecordCount: 0,
    divergenceCount: 0,
    pendingBackfillCount: 0,
    stateFingerprint: null,
    legacyFieldFingerprints: Object.freeze([]),
    blockers: Object.freeze(blockers),
  });
}

function uniqueField(fields, fieldName) {
  const matches = fields.filter((field) => normalizeName(field.fieldName) === normalizeName(fieldName));
  if (matches.length > 1) return {
    field: null,
    blocker: safeBlocker('REPORT_METRIC_FIELD_MIGRATION_FIELD_AMBIGUOUS', {
      fieldName,
      fieldCount: matches.length,
    }),
  };
  return { field: matches[0] ?? null, blocker: null };
}

function readSingleSelectValue(value) {
  if (Array.isArray(value) && value.length > 1) throw new TypeError(
    'Archived display SingleSelect contains multiple entries',
  );
  return readLarkText(value, { allowNull: true, label: 'archived display SingleSelect' });
}

function readFieldValue(fields, fieldName) {
  const entry = Object.entries(fields ?? {}).find(
    ([name]) => normalizeName(name) === normalizeName(fieldName),
  );
  return entry?.[1] ?? null;
}

function setFieldValue(fields, fieldName, value) {
  const entry = Object.keys(fields ?? {}).find(
    (name) => normalizeName(name) === normalizeName(fieldName),
  );
  if (entry) fields[entry] = value;
  else fields[fieldName] = value;
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
      `Report Metric canonical-authority recovery requires client.${method}`,
    );
  }
  return client;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw recoveryError(
    `Report Metric canonical-authority recovery requires ${fieldName}`,
    'REPORT_METRIC_FIELD_MIGRATION_IDENTITY_INVALID',
  );
  return value.trim();
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function safeBlocker(code, details = {}) {
  return deepFreeze({ code, tableKey: TABLE_KEY, fieldName: CANONICAL_FIELD_NAME, ...details });
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

function recoveryError(message, code, details = {}) {
  return permanentError(message, { code, details });
}

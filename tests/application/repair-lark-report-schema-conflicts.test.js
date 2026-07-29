import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION,
  applyLarkReportSchemaConflictRepair,
  planLarkReportSchemaConflictRepair,
  safeReportSchemaConflictRepairEvidence,
} from '../../packages/application/src/use-cases/repair-lark-report-schema-conflicts.js';

const SCHEMA = Object.freeze([
  Object.freeze({
    key: 'reportRows',
    logicalName: 'MKT_Report_Rows',
    createName: 'MKT_Report_Rows',
    aliases: Object.freeze(['MKT_Report_Rows']),
    envName: 'LARK_TABLE_MKT_REPORT_ROWS',
    defaultViewName: 'All',
    fields: Object.freeze([
      Object.freeze({ fieldName: 'row_key', type: 1, uiType: 'Text', primary: true }),
      Object.freeze({
        fieldName: 'coverage_rate',
        type: 2,
        uiType: 'Number',
        primary: false,
        property: Object.freeze({ formatter: '0.0000' }),
      }),
    ]),
  }),
]);

const VALIDATE = () => true;

function baseState(overrides = {}) {
  return {
    tables: [{ tableId: 'tblReport', name: 'MKT_Report_Rows' }],
    fieldsByTable: {
      tblReport: [
        { fieldId: 'fldKey', fieldName: 'row_key', type: 1, uiType: 'Text', isPrimary: true, property: null },
        { fieldId: 'fldCoverage', fieldName: 'coverage_rate', type: 1, uiType: 'Text', isPrimary: false, property: null },
      ],
    },
    recordsByTable: { tblReport: [] },
    updates: [],
    ...overrides,
  };
}

test('repairs a non-primary type mismatch only when every existing field value is empty', async () => {
  const state = baseState({
    recordsByTable: {
      tblReport: [
        { recordId: 'rec1', fields: { row_key: 'one', coverage_rate: null } },
        { recordId: 'rec2', fields: { row_key: 'two', coverage_rate: '' } },
      ],
    },
  });
  const client = statefulClient(state);
  const preview = await planLarkReportSchemaConflictRepair({
    client,
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
  });
  assert.equal(preview.conflictCount, 1);
  assert.equal(preview.repairable, true);
  assert.equal(preview.repairActions[0].kind, 'update_empty_field_type');
  assert.equal(preview.repairActions[0].recordCount, 2);
  assert.equal(preview.repairActions[0].populatedRecordCount, 0);

  const applied = await applyLarkReportSchemaConflictRepair({
    client,
    env: { CONFIRM_REPORT_SCHEMA_CONFLICT_REPAIR: REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION },
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
  });
  assert.equal(applied.appliedRepairCount, 1);
  assert.equal(applied.remainingConflictCount, 0);
  assert.equal(state.fieldsByTable.tblReport[1].type, 2);
  assert.equal(state.updates.length, 1);
});

test('observed zero and false are Business values and block a field type mutation', async () => {
  for (const value of [0, false]) {
    const state = baseState({
      recordsByTable: { tblReport: [{ recordId: 'rec1', fields: { row_key: 'one', coverage_rate: value } }] },
    });
    const preview = await planLarkReportSchemaConflictRepair({
      client: statefulClient(state),
      schema: SCHEMA,
      schemaVersion: 'test-v1',
      validateSchema: VALIDATE,
    });
    assert.equal(preview.repairable, false);
    assert.equal(preview.blockers[0].code, 'REPORT_SCHEMA_CONFLICT_POPULATED_FIELD');
    assert.equal(preview.blockers[0].populatedRecordCount, 1);
  }
});

test('archives only excess non-primary duplicate fields when the entire table has no records', async () => {
  const state = baseState({
    fieldsByTable: {
      tblReport: [
        { fieldId: 'fldKey', fieldName: 'row_key', type: 1, uiType: 'Text', isPrimary: true, property: null },
        { fieldId: 'fldCoverageA', fieldName: 'coverage_rate', type: 2, uiType: 'Number', isPrimary: false, property: { formatter: '0.0000' } },
        { fieldId: 'fldCoverageB', fieldName: 'coverage_rate', type: 1, uiType: 'Text', isPrimary: false, property: null },
      ],
    },
  });
  const client = statefulClient(state);
  const preview = await planLarkReportSchemaConflictRepair({
    client,
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
  });
  assert.equal(preview.repairable, true);
  assert.equal(preview.conflictCount, 1);
  assert.equal(preview.repairActionCount, 1);
  assert.equal(preview.repairActions[0].kind, 'archive_empty_duplicate_field');

  const applied = await applyLarkReportSchemaConflictRepair({
    client,
    env: { CONFIRM_REPORT_SCHEMA_CONFLICT_REPAIR: REPORT_SCHEMA_CONFLICT_REPAIR_CONFIRMATION },
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
  });
  assert.equal(applied.remainingConflictCount, 0);
  assert.match(state.fieldsByTable.tblReport[2].fieldName, /^__mkt_archived_duplicate_/u);
  assert.equal(state.fieldsByTable.tblReport[1].fieldName, 'coverage_rate');
});

test('duplicate field names in a populated table remain fail-closed because values cannot be attributed safely', async () => {
  const state = baseState({
    fieldsByTable: {
      tblReport: [
        { fieldId: 'fldKey', fieldName: 'row_key', type: 1, uiType: 'Text', isPrimary: true, property: null },
        { fieldId: 'fldCoverageA', fieldName: 'coverage_rate', type: 2, uiType: 'Number', isPrimary: false, property: { formatter: '0.0000' } },
        { fieldId: 'fldCoverageB', fieldName: 'coverage_rate', type: 1, uiType: 'Text', isPrimary: false, property: null },
      ],
    },
    recordsByTable: { tblReport: [{ recordId: 'rec1', fields: { row_key: 'one', coverage_rate: null } }] },
  });
  const preview = await planLarkReportSchemaConflictRepair({
    client: statefulClient(state),
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
  });
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockers[0].code, 'REPORT_SCHEMA_CONFLICT_DUPLICATE_POPULATED_TABLE');
  assert.equal(preview.blockers[0].recordCount, 1);
});

test('unsupported conflicts stay blocked and safe evidence removes physical IDs', async () => {
  const state = baseState();
  const preview = await planLarkReportSchemaConflictRepair({
    client: statefulClient(state),
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
    preview: {
      conflicts: [{
        code: 'AMBIGUOUS_TABLE_NAME',
        tableKey: 'reportRows',
        fieldName: 'coverage_rate',
        tableId: 'tblSecret',
        fieldId: 'fldSecret',
      }],
      environmentUpdates: {},
    },
  });
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockers[0].code, 'REPORT_SCHEMA_CONFLICT_UNSUPPORTED');
  const safe = safeReportSchemaConflictRepairEvidence({ preview, tableId: 'tblSecret', fieldId: 'fldSecret' });
  assert.equal(JSON.stringify(safe).includes('tblSecret'), false);
  assert.equal(JSON.stringify(safe).includes('fldSecret'), false);
});

function statefulClient(state) {
  return {
    async listTables() {
      return state.tables.map((table) => ({ ...table }));
    },
    async listFields({ tableId }) {
      return (state.fieldsByTable[tableId] ?? []).map((field) => structuredClone(field));
    },
    async listRecords({ tableId }) {
      return (state.recordsByTable[tableId] ?? []).map((record) => structuredClone(record));
    },
    async updateField({ tableId, fieldId, field }) {
      const fields = state.fieldsByTable[tableId];
      const index = fields.findIndex((candidate) => candidate.fieldId === fieldId);
      assert.notEqual(index, -1);
      fields[index] = {
        ...fields[index],
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType ?? fields[index].uiType,
        description: field.description ?? '',
        property: structuredClone(field.property ?? null),
      };
      state.updates.push({ tableId, fieldId, field: structuredClone(field) });
      return structuredClone(fields[index]);
    },
  };
}

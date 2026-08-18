import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLarkBaseConsolidation } from '../../packages/application/src/use-cases/consolidate-lark-base.js';

function field(fieldId, fieldName, type, property = null, primary = false) {
  return {
    fieldId,
    fieldName,
    type,
    uiType: type === 5 ? 'DateTime' : 'Text',
    description: '',
    isPrimary: primary,
    property,
  };
}

function record(recordId, key, publishedAt) {
  return {
    recordId,
    fields: { key, published_at: publishedAt },
    createdTime: null,
    lastModifiedTime: null,
    lastModifiedBy: null,
  };
}

class ReadOnlyClient {
  constructor({ tableId, dateProperty, listedPublicLevel, detailedPublicLevel }) {
    this.tableId = tableId;
    this.dateProperty = dateProperty;
    this.listedPublicLevel = listedPublicLevel;
    this.detailedPublicLevel = detailedPublicLevel;
    this.calls = [];
  }

  async listTables() {
    return [{ tableId: this.tableId, name: 'TikTok', revision: 1 }];
  }

  async listFields() {
    return [
      field(`${this.tableId}_key`, 'key', 1, null, true),
      field(`${this.tableId}_date`, 'published_at', 5, this.dateProperty),
    ];
  }

  async listRecords() {
    return [record(`${this.tableId}_rec`, 'v1', 1_700_000_000_000)];
  }

  async listViews() {
    return [{
      viewId: `${this.tableId}_view`,
      viewName: 'All Records',
      viewType: 'grid',
      publicLevel: this.listedPublicLevel,
      property: { hiddenFields: [], filterInfo: null },
    }];
  }

  async getView() {
    return {
      viewId: `${this.tableId}_view`,
      viewName: 'All Records',
      viewType: 'grid',
      publicLevel: this.detailedPublicLevel,
      property: { hiddenFields: [], filterInfo: null },
    };
  }
}

test('reuse_exact treats omitted Date defaults as equal to explicit Lark defaults and keeps public level from list metadata', async () => {
  const sourceClient = new ReadOnlyClient({
    tableId: 'source',
    dateProperty: null,
    listedPublicLevel: 0,
    detailedPublicLevel: 0,
  });
  const targetClient = new ReadOnlyClient({
    tableId: 'target',
    dateProperty: { date_formatter: 'yyyy/MM/dd', auto_fill: false },
    listedPublicLevel: 'Public',
    detailedPublicLevel: null,
  });

  const result = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['TikTok'],
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.reuseExactTables, 1);
  assert.equal(result.summary.conflicts, 0);
  assert.equal(result.tables[0].action, 'reuse_exact');
  assert.deepEqual(targetClient.calls, []);
});

test('reuse_exact still blocks non-default Date formatter drift', async () => {
  const sourceClient = new ReadOnlyClient({
    tableId: 'source',
    dateProperty: null,
    listedPublicLevel: 0,
    detailedPublicLevel: 0,
  });
  const targetClient = new ReadOnlyClient({
    tableId: 'target',
    dateProperty: { date_formatter: 'yyyy-MM-dd HH:mm', auto_fill: false },
    listedPublicLevel: 'Public',
    detailedPublicLevel: null,
  });

  const result = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['TikTok'],
  });

  assert.equal(result.ok, false);
  const conflict = result.conflicts.find((entry) => entry.code === 'TARGET_TABLE_CONFLICT');
  assert.ok(conflict);
  assert.equal(conflict.details.reasons.includes('field property mismatch published_at'), true);
  assert.deepEqual(conflict.details.diagnostics[0].differencePaths, ['$.date_formatter']);
});

test('reuse_exact still blocks real public-level drift', async () => {
  const sourceClient = new ReadOnlyClient({
    tableId: 'source',
    dateProperty: null,
    listedPublicLevel: 0,
    detailedPublicLevel: 0,
  });
  const targetClient = new ReadOnlyClient({
    tableId: 'target',
    dateProperty: { date_formatter: 'yyyy/MM/dd', auto_fill: false },
    listedPublicLevel: 'Private',
    detailedPublicLevel: null,
  });

  const result = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['TikTok'],
  });

  assert.equal(result.ok, false);
  const conflict = result.conflicts.find((entry) => entry.code === 'TARGET_TABLE_CONFLICT');
  assert.ok(conflict);
  assert.equal(conflict.details.reasons.includes('view configuration mismatch All Records'), true);
  assert.deepEqual(conflict.details.diagnostics[0].differencePaths, ['$.publicLevel']);
});

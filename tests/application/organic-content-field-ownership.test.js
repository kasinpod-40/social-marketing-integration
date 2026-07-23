import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOrganicContentOwnershipRoutingRepository,
  mergeOrganicContentUpdateFields,
} from '../../packages/application/src/policies/organic-content-field-ownership.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

test('manual classification preserves protected fields while system metrics still update', async () => {
  for (const [platform, contentKey] of [
    ['tiktok', 'tiktok:chemistry_k:video_1'],
    ['youtube', 'youtube:dev_ft_pumkin:video_1'],
  ]) {
    const base = createRepository({
      content: [{
        recordId: `rec_${platform}`,
        fields: {
          content_key: contentKey,
          platform,
          latest_views: 10,
          content_theme: 'Manual theme',
          course_name: 'Manual course',
          classification_source: 'manual',
          classification_confidence: 1,
          manual_tag_note: 'keep this note',
        },
      }],
    });
    const repository = createOrganicContentOwnershipRoutingRepository({
      repository: base,
      mktContentTableId: 'content',
    });
    const engine = new TableSyncEngine();
    const plan = await engine.planByKey({
      repository,
      tableId: 'content',
      keyField: 'content_key',
      rows: [{
        content_key: contentKey,
        platform,
        latest_views: 20,
        content_theme: 'Classifier theme',
        course_name: 'Classifier course',
        classification_source: 'dictionary',
        classification_confidence: 0.8,
        manual_tag_note: 'replace note',
      }],
    });

    assert.equal(plan.updateRows.length, 1);
    const result = await engine.executePlan(plan);
    assert.equal(result.updated, 1);
    const written = base.updateCalls.at(-1).records[0].fields;
    assert.equal(written.latest_views, 20);
    assert.equal(written.platform, platform);
    assert.equal(Object.hasOwn(written, 'content_theme'), false);
    assert.equal(Object.hasOwn(written, 'course_name'), false);
    assert.equal(Object.hasOwn(written, 'classification_source'), false);
    assert.equal(Object.hasOwn(written, 'classification_confidence'), false);
    assert.equal(Object.hasOwn(written, 'manual_tag_note'), false);
    const stored = base.read('content', contentKey).fields;
    assert.equal(stored.content_theme, 'Manual theme');
    assert.equal(stored.course_name, 'Manual course');
    assert.equal(stored.manual_tag_note, 'keep this note');
    assert.equal(stored.latest_views, 20);
  }
});

test('protected-only classifier differences are skipped instead of producing a false update', async () => {
  const key = 'tiktok:chemistry_k:video_2';
  const base = createRepository({
    content: [{
      recordId: 'rec_manual',
      fields: {
        content_key: key,
        latest_views: 10,
        content_theme: 'Manual',
        classification_source: 'manual',
        manual_tag_note: 'note',
      },
    }],
  });
  const repository = createOrganicContentOwnershipRoutingRepository({
    repository: base,
    mktContentTableId: 'content',
  });
  const plan = await new TableSyncEngine().planByKey({
    repository,
    tableId: 'content',
    keyField: 'content_key',
    rows: [{
      content_key: key,
      latest_views: 10,
      content_theme: 'Auto',
      classification_source: 'dictionary',
      manual_tag_note: 'new note',
    }],
  });

  assert.equal(plan.updateRows.length, 0);
  assert.equal(plan.skipped, 1);
  assert.equal(base.updateCalls.length, 0);
});

test('non-manual rows fill blank classification only and never overwrite existing values or notes', async () => {
  const key = 'youtube:dev_ft_pumkin:video_2';
  const base = createRepository({
    content: [{
      recordId: 'rec_auto',
      fields: {
        content_key: key,
        latest_views: 5,
        course_name: 'Existing course',
        content_theme: '',
        classification_source: 'dictionary',
        classification_confidence: 0.5,
        manual_tag_note: 'human note',
      },
    }],
  });
  const repository = createOrganicContentOwnershipRoutingRepository({
    repository: base,
    mktContentTableId: 'content',
  });
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository,
    tableId: 'content',
    keyField: 'content_key',
    rows: [{
      content_key: key,
      latest_views: 6,
      course_name: 'Replacement course',
      content_theme: 'New theme',
      classification_source: 'dictionary',
      classification_confidence: 0.9,
      manual_tag_note: 'replacement note',
    }],
  });
  await engine.executePlan(plan);

  const written = base.updateCalls[0].records[0].fields;
  assert.equal(written.latest_views, 6);
  assert.equal(written.content_theme, 'New theme');
  assert.equal(written.classification_source, 'dictionary');
  assert.equal(written.classification_confidence, 0.9);
  assert.equal(Object.hasOwn(written, 'course_name'), false);
  assert.equal(Object.hasOwn(written, 'manual_tag_note'), false);
  const stored = base.read('content', key).fields;
  assert.equal(stored.course_name, 'Existing course');
  assert.equal(stored.content_theme, 'New theme');
  assert.equal(stored.manual_tag_note, 'human note');
});

test('create path keeps initial classification and manual note', async () => {
  const key = 'tiktok:chemistry_k:new_video';
  const base = createRepository();
  const repository = createOrganicContentOwnershipRoutingRepository({
    repository: base,
    mktContentTableId: 'content',
  });
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository,
    tableId: 'content',
    keyField: 'content_key',
    rows: [{
      content_key: key,
      latest_views: 1,
      content_theme: 'Initial theme',
      classification_source: 'dictionary',
      classification_confidence: 0.7,
      manual_tag_note: 'initial note',
    }],
  });
  await engine.executePlan(plan);

  const created = base.createCalls[0].rows[0];
  assert.equal(created.content_theme, 'Initial theme');
  assert.equal(created.classification_source, 'dictionary');
  assert.equal(created.manual_tag_note, 'initial note');
});

test('routing leaves non-content tables and read helpers unchanged', async () => {
  const base = createRepository({ daily: [] });
  const repository = createOrganicContentOwnershipRoutingRepository({
    repository: base,
    mktContentTableId: 'content',
  });
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository,
    tableId: 'daily',
    keyField: 'content_daily_key',
    rows: [{ content_daily_key: 'daily_1', manual_tag_note: 'ordinary field' }],
  });
  await engine.executePlan(plan);
  assert.equal(base.createCalls[0].rows[0].manual_tag_note, 'ordinary field');

  assert.deepEqual(await repository.searchRecords('content', { maxItems: 1 }), ['search-ok']);
  assert.deepEqual(await repository.listPage('content', { pageSize: 1 }), { records: ['page-ok'] });
  assert.deepEqual(await repository.getTableFields('content'), ['fields-ok']);
});

test('direct ownership merge rejects clearing protected values', () => {
  const result = mergeOrganicContentUpdateFields({
    existingFields: {
      content_key: 'key',
      course_name: 'Existing',
      classification_source: 'dictionary',
      manual_tag_note: 'note',
    },
    incomingFields: {
      content_key: 'key',
      latest_views: 2,
      course_name: null,
      manual_tag_note: '',
    },
  });
  assert.deepEqual(result, { content_key: 'key', latest_views: 2 });
});

function createRepository(seed = {}) {
  const tables = new Map();
  for (const [tableId, records] of Object.entries(seed)) {
    tables.set(tableId, records.map((record) => ({
      recordId: record.recordId,
      fields: { ...record.fields },
    })));
  }
  const createCalls = [];
  const updateCalls = [];

  return {
    createCalls,
    updateCalls,
    async prepareRows(_tableId, rows) { return rows.map((row) => Object.freeze({ ...row })); },
    async listAll(tableId) { return [...(tables.get(tableId) ?? [])]; },
    async listByFieldValues(tableId, fieldName, values) {
      const allowed = new Set(values.map(String));
      return (tables.get(tableId) ?? []).filter((record) => allowed.has(String(record.fields[fieldName])));
    },
    async prepareExistingRecords(_tableId, records, context = {}) {
      const fields = new Set(context.incomingFieldNames ?? []);
      return records.map((record) => ({
        recordId: record.recordId,
        fields: Object.fromEntries(Object.entries(record.fields).filter(([name]) => fields.has(name))),
      }));
    },
    async createMany(tableId, rows) {
      createCalls.push({ tableId, rows });
      const records = tables.get(tableId) ?? [];
      rows.forEach((fields, index) => records.push({ recordId: `created_${records.length + index}`, fields: { ...fields } }));
      tables.set(tableId, records);
      return { created: rows.length };
    },
    async updateMany(tableId, records) {
      updateCalls.push({ tableId, records });
      const stored = tables.get(tableId) ?? [];
      for (const update of records) {
        const target = stored.find((record) => record.recordId === update.recordId);
        Object.assign(target.fields, update.fields);
      }
      return { updated: records.length };
    },
    async searchRecords() { return ['search-ok']; },
    async listPage() { return { records: ['page-ok'] }; },
    async getTableFields() { return ['fields-ok']; },
    read(tableId, stableKey) {
      return (tables.get(tableId) ?? []).find((record) => (
        record.fields.content_key === stableKey || record.fields.content_daily_key === stableKey
      ));
    },
  };
}

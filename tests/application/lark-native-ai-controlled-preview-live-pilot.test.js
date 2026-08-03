import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyLarkNativeAiControlledPreviewLivePilot,
  planLarkNativeAiControlledPreviewLivePilot,
} from '../../packages/application/src/reports/apply-lark-native-ai-controlled-preview-live-pilot.js';
import {
  buildControlledPreviewReadinessPlans,
} from '../helpers/lark-native-ai-controlled-preview-readiness-plans.js';

class FakeLarkClient {
  constructor(options = {}) {
    this.tableName = options.tableName ?? '🧠 MKT_AI_Report_Runs';
    this.records = structuredClone(options.records ?? []);
    this.createCalls = 0;
    this.updateCalls = 0;
    this.delayVisibilityAfterWrite = options.delayVisibilityAfterWrite === true;
    this.writesVisible = true;
  }

  async listTables() {
    return [{ tableId: 'tbl_preview', name: this.tableName }];
  }

  async searchRecordsByFieldValues({ fieldName, values }) {
    if (!this.writesVisible) return [];
    const accepted = new Set(values);
    return this.records
      .filter(({ fields }) => accepted.has(fields[fieldName]))
      .map((record) => structuredClone(record));
  }

  async batchCreateRecords({ records }) {
    this.createCalls += 1;
    for (const fields of records) {
      this.records.push({
        recordId: `rec_${String(this.records.length + 1).padStart(3, '0')}`,
        fields: structuredClone(fields),
      });
    }
    if (this.delayVisibilityAfterWrite) this.writesVisible = false;
    return { created: records.length };
  }

  async batchUpdateRecords({ records }) {
    this.updateCalls += 1;
    for (const update of records) {
      const target = this.records.find(({ recordId }) => recordId === update.recordId);
      assert.ok(target, `missing fake update target ${update.recordId}`);
      Object.assign(target.fields, structuredClone(update.fields));
    }
    if (this.delayVisibilityAfterWrite) this.writesVisible = false;
    return { updated: records.length };
  }
}

test('applies forty Preview Records and verifies exact zero drift', async () => {
  const input = await buildControlledPreviewReadinessPlans();
  const client = new FakeLarkClient();
  const result = await applyPilot(client, input);

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'applied_and_verified');
  assert.deepEqual(result.writes, { created: 40, updated: 0, total: 40 });
  assert.equal(result.verification.status, 'zero_drift');
  assert.equal(result.verification.counts.noOp, 40);
  assert.equal(result.verification.counts.write, 0);
  assert.equal(client.records.length, 40);
  assert.equal(client.records.every(({ fields }) => fields.preview_mode === true), true);
  assert.equal(client.records.every(({ fields }) => fields.notification_eligible === false), true);
  assert.equal(client.records.every(({ fields }) => fields.sent_to_group === false), true);
  assert.equal(client.createCalls, 1);
  assert.equal(client.updateCalls, 0);
});

test('waits for delayed Lark read-after-write visibility before zero-drift verification', async () => {
  const input = await buildControlledPreviewReadinessPlans();
  const client = new FakeLarkClient({ delayVisibilityAfterWrite: true });
  const delays = [];

  const result = await applyPilot(client, input, {
    sleep: async (delayMs) => {
      delays.push(delayMs);
      client.writesVisible = true;
    },
  });

  assert.deepEqual(delays, [10_000]);
  assert.equal(result.mode, 'applied_and_verified');
  assert.deepEqual(result.writes, { created: 40, updated: 0, total: 40 });
  assert.equal(result.verification.status, 'zero_drift');
  assert.equal(result.verification.counts.noOp, 40);
  assert.equal(client.records.length, 40);
});

test('same-input replay performs zero writes', async () => {
  const input = await buildControlledPreviewReadinessPlans();
  const client = new FakeLarkClient();
  await applyPilot(client, input);
  client.createCalls = 0;
  client.updateCalls = 0;

  const replay = await applyPilot(client, input);
  assert.equal(replay.mode, 'already_zero_drift');
  assert.deepEqual(replay.writes, { created: 0, updated: 0, total: 0 });
  assert.equal(client.createCalls, 0);
  assert.equal(client.updateCalls, 0);
});

test('partial resume creates only missing identities', async () => {
  const input = await buildControlledPreviewReadinessPlans();
  const complete = new FakeLarkClient();
  await applyPilot(complete, input);
  const client = new FakeLarkClient({ records: complete.records.slice(0, 13) });

  const result = await applyPilot(client, input);
  assert.deepEqual(result.writes, { created: 27, updated: 0, total: 27 });
  assert.equal(client.records.length, 40);
  assert.equal(result.verification.status, 'zero_drift');
});

test('blocks unsafe retained sent Records before any write', async () => {
  const input = await buildControlledPreviewReadinessPlans();
  const seeded = new FakeLarkClient();
  await applyPilot(seeded, input);
  seeded.records[0].fields.sent_to_group = true;
  seeded.createCalls = 0;
  seeded.updateCalls = 0;

  await assert.rejects(
    () => applyPilot(seeded, input),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_BLOCKED',
  );
  assert.equal(seeded.createCalls, 0);
  assert.equal(seeded.updateCalls, 0);
});

test('requires one exact existing target Table', async () => {
  const input = await buildControlledPreviewReadinessPlans();
  const client = new FakeLarkClient({ tableName: 'Wrong table' });
  await assert.rejects(
    () => planLarkNativeAiControlledPreviewLivePilot({ client, ...input }),
    (error) => error.code === 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_TARGET_TABLE_INVALID',
  );
});

test('retains fail-closed Remote-lock and Approval gates from readiness', async () => {
  const input = await buildControlledPreviewReadinessPlans({ lockReleased: false, approved: false });
  const client = new FakeLarkClient();
  const plan = await planLarkNativeAiControlledPreviewLivePilot({ client, ...input });
  assert.equal(plan.ok, false);
  assert.equal(plan.executionPlan.status, 'blocked');
  assert.equal(plan.executionPlan.actions.length, 0);
  assert.equal(client.createCalls, 0);
  assert.equal(client.updateCalls, 0);
});

function applyPilot(client, input, options = {}) {
  return applyLarkNativeAiControlledPreviewLivePilot({
    client,
    ...input,
    sleep: options.sleep ?? (async () => {
      client.writesVisible = true;
    }),
  });
}

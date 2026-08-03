import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_NATIVE_AI_DESTINATION_BINDING_REQUIRED_FIELDS,
  LARK_NATIVE_AI_SETTINGS_TABLE,
  LARK_NATIVE_AI_TARGET_GROUP_NAME,
} from '../../packages/config/src/lark-native-ai-destination-binding-contract.js';
import {
  applyLarkNativeAiDestinationBinding,
  inspectLarkNativeAiDestinationBinding,
} from '../../scripts/lib/lark-native-ai-destination-binding.js';

class FakeClient {
  constructor(options = {}) {
    this.chatId = options.chatId ?? 'oc_verified_destination';
    this.chatNames = options.chatNames ?? [LARK_NATIVE_AI_TARGET_GROUP_NAME];
    this.records = structuredClone(options.records ?? buildRows(66));
    this.updateCalls = [];
  }

  async listTables() {
    return [{ tableId: 'tbl_settings', name: LARK_NATIVE_AI_SETTINGS_TABLE }];
  }

  async listFields() {
    return LARK_NATIVE_AI_DESTINATION_BINDING_REQUIRED_FIELDS.map((fieldName) => ({ fieldName }));
  }

  async listRecords() {
    return structuredClone(this.records);
  }

  async listChats() {
    return this.chatNames.map((name, index) => ({
      chatId: index === 0 ? this.chatId : `${this.chatId}_${index}`,
      name,
    }));
  }

  async batchUpdateRecords({ records }) {
    this.updateCalls.push(structuredClone(records));
    for (const update of records) {
      const target = this.records.find(({ recordId }) => recordId === update.recordId);
      if (!target) throw new Error('unknown record');
      Object.assign(target.fields, update.fields);
    }
    return { updated: records.length };
  }
}

function buildRows(count, overrides = {}) {
  return Array.from({ length: count }, (_, index) => ({
    recordId: `rec_${String(index + 1).padStart(3, '0')}`,
    fields: {
      customer_profile: 'integration_workspace',
      group_id: '',
      ai_enabled: false,
      notification_enabled: false,
      ...overrides,
    },
  }));
}

const noWait = async () => undefined;

test('binds the exact visible chat to all sixty-six empty Integration Workspace rows', async () => {
  const client = new FakeClient();
  const result = await applyLarkNativeAiDestinationBinding({ client, sleep: noWait });

  assert.equal(result.ok, true);
  assert.equal(result.mode, 'applied');
  assert.equal(result.status, 'zero_drift');
  assert.equal(result.integrationRowCount, 66);
  assert.equal(result.updatedRecordCount, 66);
  assert.equal(result.recordWriteCount, 66);
  assert.equal(client.updateCalls.length, 1);
  assert.equal(client.updateCalls[0].length, 66);
  assert.equal(client.records.every(({ fields }) => fields.group_id === client.chatId), true);
  assert.equal(client.records.every(({ fields }) => fields.ai_enabled === false), true);
  assert.equal(client.records.every(({ fields }) => fields.notification_enabled === false), true);
  assert.match(result.destinationKeyHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes(client.chatId), false);
  assert.equal(result.notificationCount, 0);
  assert.equal(result.scheduleEnabled, false);
});

test('same-input replay is zero drift with no Record write', async () => {
  const client = new FakeClient();
  await applyLarkNativeAiDestinationBinding({ client, sleep: noWait });
  client.updateCalls = [];

  const replay = await applyLarkNativeAiDestinationBinding({ client, sleep: noWait });
  assert.equal(replay.mode, 'already_zero_drift');
  assert.equal(replay.recordWriteCount, 0);
  assert.equal(client.updateCalls.length, 0);
});

test('fills only empty rows when a partial retained binding already matches the exact chat', async () => {
  const rows = buildRows(10);
  rows.slice(0, 4).forEach(({ fields }) => { fields.group_id = 'oc_verified_destination'; });
  const client = new FakeClient({ records: rows });

  const result = await applyLarkNativeAiDestinationBinding({ client, sleep: noWait });
  assert.equal(result.updatedRecordCount, 6);
  assert.equal(client.updateCalls[0].length, 6);
  assert.equal(client.records.every(({ fields }) => fields.group_id === client.chatId), true);
});

test('blocks a conflicting retained destination before write', async () => {
  const rows = buildRows(5);
  rows[0].fields.group_id = 'oc_wrong_destination';
  const client = new FakeClient({ records: rows });

  await assert.rejects(
    () => applyLarkNativeAiDestinationBinding({ client, sleep: noWait }),
    (error) => error.code === 'LARK_NATIVE_AI_DESTINATION_BINDING_BLOCKED'
      && error.details.blockers.some(({ code }) => code === 'SETTINGS_GROUP_ID_CONFLICT'),
  );
  assert.equal(client.updateCalls.length, 0);
});

test('blocks activation flags before write', async () => {
  const rows = buildRows(5);
  rows[2].fields.ai_enabled = true;
  const client = new FakeClient({ records: rows });

  await assert.rejects(
    () => applyLarkNativeAiDestinationBinding({ client, sleep: noWait }),
    (error) => error.code === 'LARK_NATIVE_AI_DESTINATION_BINDING_BLOCKED'
      && error.details.blockers.some(({ code }) => code === 'SETTINGS_ACTIVATION_FLAGS_NOT_ALL_FALSE'),
  );
  assert.equal(client.updateCalls.length, 0);
});

test('reports a missing or duplicate exact chat as a blocker without exposing chat IDs', async () => {
  const missing = await inspectLarkNativeAiDestinationBinding({
    client: new FakeClient({ chatNames: [] }),
  });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.blockers.some(({ code }) => code === 'TARGET_GROUP_NOT_VISIBLE_TO_APP'), true);

  const duplicate = await inspectLarkNativeAiDestinationBinding({
    client: new FakeClient({
      chatNames: [LARK_NATIVE_AI_TARGET_GROUP_NAME, LARK_NATIVE_AI_TARGET_GROUP_NAME],
    }),
  });
  assert.equal(duplicate.status, 'blocked');
  assert.equal(duplicate.blockers.some(({ code }) => code === 'TARGET_GROUP_IDENTITY_AMBIGUOUS'), true);
  assert.equal(JSON.stringify(duplicate).includes('oc_verified_destination'), false);
});

test('blocks more than one reviewed Lark batch before write', async () => {
  const client = new FakeClient({ records: buildRows(101) });
  await assert.rejects(
    () => applyLarkNativeAiDestinationBinding({ client, sleep: noWait }),
    (error) => error.code === 'LARK_NATIVE_AI_DESTINATION_BINDING_RECORD_LIMIT_EXCEEDED',
  );
  assert.equal(client.updateCalls.length, 0);
});

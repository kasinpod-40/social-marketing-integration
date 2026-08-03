import {
  LARK_NATIVE_AI_DESTINATION_BINDING_LIMITS,
  LARK_NATIVE_AI_DESTINATION_BINDING_REQUIRED_FIELDS,
  LARK_NATIVE_AI_DESTINATION_BINDING_VERSION,
  LARK_NATIVE_AI_SETTINGS_TABLE,
  LARK_NATIVE_AI_TARGET_GROUP_NAME,
} from '../../packages/config/src/lark-native-ai-destination-binding-contract.js';

/**
 * Bind the exact Lark chat ID to every Integration Workspace Settings row.
 *
 * The raw chat ID is used only in memory and as the exact value of `group_id` in Lark Base.
 * Returned summaries contain only SHA-256 and counts. Existing non-empty conflicting destinations,
 * activation flags or ambiguous identities fail closed before any write.
 */
export async function applyLarkNativeAiDestinationBinding(input = {}) {
  const client = requireClient(input.client);
  const sleep = typeof input.sleep === 'function' ? input.sleep : defaultSleep;
  const targetGroupName = optionalText(input.targetGroupName) ?? LARK_NATIVE_AI_TARGET_GROUP_NAME;

  const before = await loadBindingState({ client, targetGroupName });
  assertSafeState(before);

  if (before.emptyDestinationRows.length === 0) {
    return freeze({
      ok: true,
      contractVersion: LARK_NATIVE_AI_DESTINATION_BINDING_VERSION,
      mode: 'already_zero_drift',
      status: 'zero_drift',
      targetGroupName,
      integrationRowCount: before.integrationRows.length,
      updatedRecordCount: 0,
      destinationKeyHash: before.destinationKeyHash,
      activationFlagsAllFalse: true,
      rawChatIdPersistedInEvidence: false,
      recordWriteCount: 0,
      workflowCreateCount: 0,
      workflowUpdateCount: 0,
      workflowStatusChangeCount: 0,
      notificationCount: 0,
      webhookActionCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    });
  }

  const records = before.emptyDestinationRows.map(({ recordId }) => ({
    recordId,
    fields: { group_id: before.chatId },
  }));
  if (records.length > LARK_NATIVE_AI_DESTINATION_BINDING_LIMITS.maximumRecordWrites) {
    throw bindingError(
      'Destination binding exceeded the reviewed Record-write limit',
      'LARK_NATIVE_AI_DESTINATION_BINDING_RECORD_LIMIT_EXCEEDED',
      { observed: records.length },
    );
  }

  await client.batchUpdateRecords({ tableId: before.settingsTableId, records });
  await sleep(LARK_NATIVE_AI_DESTINATION_BINDING_LIMITS.readAfterWriteDelayMs);

  const after = await loadBindingState({ client, targetGroupName });
  assertSafeState(after);
  if (after.emptyDestinationRows.length !== 0
    || after.integrationRows.length !== before.integrationRows.length
    || after.destinationKeyHash !== before.chatIdHash) {
    throw bindingError(
      'Destination binding readback did not reach exact zero drift',
      'LARK_NATIVE_AI_DESTINATION_BINDING_READBACK_FAILED',
      {
        integrationRowCountBefore: before.integrationRows.length,
        integrationRowCountAfter: after.integrationRows.length,
        emptyDestinationCountAfter: after.emptyDestinationRows.length,
        destinationHashMatches: after.destinationKeyHash === before.chatIdHash,
      },
    );
  }

  return freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_DESTINATION_BINDING_VERSION,
    mode: 'applied',
    status: 'zero_drift',
    targetGroupName,
    integrationRowCount: after.integrationRows.length,
    updatedRecordCount: records.length,
    destinationKeyHash: after.destinationKeyHash,
    activationFlagsAllFalse: true,
    rawChatIdPersistedInEvidence: false,
    recordWriteCount: records.length,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    notificationCount: 0,
    webhookActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

export async function inspectLarkNativeAiDestinationBinding(input = {}) {
  const client = requireClient(input.client);
  const targetGroupName = optionalText(input.targetGroupName) ?? LARK_NATIVE_AI_TARGET_GROUP_NAME;
  const state = await loadBindingState({ client, targetGroupName });
  const blockers = buildBlockers(state);
  return freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_DESTINATION_BINDING_VERSION,
    status: blockers.length === 0
      ? (state.emptyDestinationRows.length === 0 ? 'zero_drift' : 'ready_to_bind')
      : 'blocked',
    targetGroupName,
    integrationRowCount: state.integrationRows.length,
    emptyDestinationCount: state.emptyDestinationRows.length,
    nonEmptyDestinationCount: state.nonEmptyDestinationRows.length,
    distinctDestinationCount: state.distinctDestinations.length,
    destinationKeyHash: state.destinationKeyHash,
    exactNameMatchCount: state.exactNameMatchCount,
    activationFlagsAllFalse: state.activationFlagsAllFalse,
    blockerCount: blockers.length,
    blockers,
    plannedRecordWriteCount: blockers.length === 0 ? state.emptyDestinationRows.length : 0,
    rawChatIdPersistedInEvidence: false,
  });
}

async function loadBindingState({ client, targetGroupName }) {
  const tables = requireArray(await client.listTables(), 'listTables result');
  const tableMatches = tables.filter(({ name }) => name === LARK_NATIVE_AI_SETTINGS_TABLE);
  if (tableMatches.length !== 1) {
    throw bindingError(
      'Settings table identity must resolve exactly once',
      'LARK_NATIVE_AI_DESTINATION_BINDING_SETTINGS_TABLE_INVALID',
      { count: tableMatches.length },
    );
  }
  const settingsTableId = requireText(tableMatches[0].tableId, 'settingsTable.tableId');
  const fields = requireArray(await client.listFields({ tableId: settingsTableId }), 'Settings fields');
  assertRequiredFields(fields);

  const allRecords = requireArray(await client.listRecords({
    tableId: settingsTableId,
    pageSize: 500,
    includeRecordMetadata: false,
  }), 'Settings records');
  if (allRecords.length > LARK_NATIVE_AI_DESTINATION_BINDING_LIMITS.maximumSettingsRecords) {
    throw bindingError(
      'Settings inventory exceeded the reviewed bounded read',
      'LARK_NATIVE_AI_DESTINATION_BINDING_SETTINGS_LIMIT_EXCEEDED',
      { observed: allRecords.length },
    );
  }

  const integrationRows = allRecords
    .filter(({ fields: recordFields }) => textValue(recordFields?.customer_profile) === 'integration_workspace')
    .map((record) => ({
      recordId: requireText(record.recordId, 'settings.recordId'),
      groupId: textValue(record.fields?.group_id),
      aiEnabled: booleanValue(record.fields?.ai_enabled),
      notificationEnabled: booleanValue(record.fields?.notification_enabled),
    }));

  const chats = requireArray(await client.listChats(), 'listChats result');
  const matches = chats.filter(({ name }) => name === targetGroupName);
  const chatId = matches.length === 1 ? requireText(matches[0].chatId, 'targetChat.chatId') : null;
  const chatIdHash = chatId ? await sha256Hex(chatId) : null;
  const emptyDestinationRows = integrationRows.filter(({ groupId }) => groupId === '');
  const nonEmptyDestinationRows = integrationRows.filter(({ groupId }) => groupId !== '');
  const distinctDestinations = [...new Set(nonEmptyDestinationRows.map(({ groupId }) => groupId))];
  const destinationKeyHash = distinctDestinations.length === 1
    ? await sha256Hex(distinctDestinations[0])
    : null;
  const activationFlagsAllFalse = integrationRows.every(({ aiEnabled, notificationEnabled }) => (
    aiEnabled === false && notificationEnabled === false
  ));

  return {
    settingsTableId,
    integrationRows,
    emptyDestinationRows,
    nonEmptyDestinationRows,
    distinctDestinations,
    destinationKeyHash,
    exactNameMatchCount: matches.length,
    chatId,
    chatIdHash,
    activationFlagsAllFalse,
  };
}

function buildBlockers(state) {
  const blockers = [];
  if (state.integrationRows.length === 0) blockers.push(blocker('SETTINGS_INTEGRATION_ROWS_MISSING'));
  if (state.exactNameMatchCount === 0) blockers.push(blocker('TARGET_GROUP_NOT_VISIBLE_TO_APP'));
  if (state.exactNameMatchCount > 1) blockers.push(blocker(
    'TARGET_GROUP_IDENTITY_AMBIGUOUS',
    { count: state.exactNameMatchCount },
  ));
  if (!state.activationFlagsAllFalse) blockers.push(blocker('SETTINGS_ACTIVATION_FLAGS_NOT_ALL_FALSE'));
  if (state.distinctDestinations.length > 1) blockers.push(blocker(
    'SETTINGS_GROUP_ID_AMBIGUOUS',
    { distinctDestinationCount: state.distinctDestinations.length },
  ));
  if (state.distinctDestinations.length === 1 && state.chatId
    && state.distinctDestinations[0] !== state.chatId) blockers.push(blocker(
    'SETTINGS_GROUP_ID_CONFLICT',
  ));
  return freeze(blockers.sort((left, right) => left.code.localeCompare(right.code)));
}

function assertSafeState(state) {
  const blockers = buildBlockers(state);
  if (blockers.length > 0) throw bindingError(
    'Destination binding found blockers before write',
    'LARK_NATIVE_AI_DESTINATION_BINDING_BLOCKED',
    { blockerCount: blockers.length, blockers },
  );
}

function assertRequiredFields(fields) {
  const names = fields.map(({ fieldName, field_name: fieldNameLegacy }) => (
    optionalText(fieldName ?? fieldNameLegacy)
  )).filter(Boolean);
  for (const fieldName of LARK_NATIVE_AI_DESTINATION_BINDING_REQUIRED_FIELDS) {
    const count = names.filter((name) => name === fieldName).length;
    if (count !== 1) throw bindingError(
      'Required Settings field identity is missing or duplicated',
      'LARK_NATIVE_AI_DESTINATION_BINDING_FIELD_INVALID',
      { fieldName, count },
    );
  }
}

function requireClient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('client is required');
  for (const method of ['listTables', 'listFields', 'listRecords', 'listChats', 'batchUpdateRecords']) {
    if (typeof value[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return value;
}

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.length === 1 ? textValue(value[0]) : '';
  if (value && typeof value === 'object') {
    return textValue(value.text ?? value.name ?? value.value ?? value.id ?? '');
  }
  return '';
}

function booleanValue(value) {
  if (typeof value === 'boolean') return value;
  const text = textValue(value).toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no' || text === '') return false;
  return null;
}

function blocker(code, details = {}) {
  return freeze({ code, ...details });
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${fieldName} is required`);
  return text;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}
export function bindingError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiDestinationBindingError';
  error.code = code;
  error.details = freeze({ ...details });
  return error;
}

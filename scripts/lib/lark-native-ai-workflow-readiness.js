import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES,
  LARK_NATIVE_AI_REQUIRED_SETTINGS_FIELDS,
  LARK_NATIVE_AI_REQUIRED_WORKFLOW_FIELDS,
  LARK_NATIVE_AI_SETTINGS_TABLE,
  LARK_NATIVE_AI_TARGET_GROUP_NAME,
  LARK_NATIVE_AI_TARGET_TABLE,
  LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS,
  LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
  LARK_NOTIFICATION_LOG_TABLE_NAME,
} from '../../packages/config/src/lark-native-ai-workflow-readiness-contract.js';
import { planLarkNotificationLogSchema } from './lark-notification-log-schema.js';

const ENABLED_WORKFLOW_STATUSES = new Set(['enabled', 'active', 'running', 'on']);
const DISABLED_WORKFLOW_STATUSES = new Set(['disabled', 'inactive', 'off', 'draft']);
const AI_OUTPUT_FIELDS = new Set([
  'insight_summary', 'strengths', 'weaknesses', 'recommendations',
]);

/**
 * Inspect the exact live prerequisites for creating the two approved Lark workflows disabled.
 * This function performs reads only. Missing target workflows are expected and become create plans,
 * while destination/schema conflicts fail closed as readiness blockers.
 */
export async function inspectLarkNativeAiWorkflowReadiness(input = {}) {
  const client = requireClient(input.client);
  const notificationPlanner = input.notificationPlanner ?? planLarkNotificationLogSchema;
  if (typeof notificationPlanner !== 'function') throw new TypeError('notificationPlanner is required');
  const expectedGroupName = optionalText(input.expectedGroupName) ?? LARK_NATIVE_AI_TARGET_GROUP_NAME;

  const blockers = [];
  const tables = requireArray(await client.listTables(), 'listTables result');
  const aiTable = uniqueNamed(tables, LARK_NATIVE_AI_TARGET_TABLE, 'AI_TABLE', blockers);
  const settingsTable = uniqueNamed(tables, LARK_NATIVE_AI_SETTINGS_TABLE, 'SETTINGS_TABLE', blockers);
  uniqueNamed(tables, LARK_NOTIFICATION_LOG_TABLE_NAME, 'NOTIFICATION_LOG_TABLE', blockers);

  const aiFields = aiTable
    ? requireArray(await client.listFields({ tableId: requireText(aiTable.tableId, 'aiTable.tableId') }), 'AI fields')
    : [];
  const settingsFields = settingsTable
    ? requireArray(await client.listFields({
      tableId: requireText(settingsTable.tableId, 'settingsTable.tableId'),
    }), 'Settings fields')
    : [];

  const aiFieldSummary = inspectRequiredFields(
    aiFields,
    LARK_NATIVE_AI_REQUIRED_WORKFLOW_FIELDS,
    'AI',
    blockers,
  );
  inspectRequiredFields(
    settingsFields,
    LARK_NATIVE_AI_REQUIRED_SETTINGS_FIELDS,
    'SETTINGS',
    blockers,
  );

  let notificationLog = null;
  try {
    const plan = await notificationPlanner({ client });
    notificationLog = freeze({
      status: plan?.status ?? null,
      fieldCount: Array.isArray(plan?.fields) ? plan.fields.length : null,
      viewCount: Array.isArray(plan?.views) ? plan.views.length : null,
    });
    if (plan?.status !== 'zero_drift') blockers.push(blocker(
      'NOTIFICATION_LOG_NOT_ZERO_DRIFT',
      { status: plan?.status ?? null },
    ));
  } catch (error) {
    blockers.push(blocker('NOTIFICATION_LOG_INSPECTION_FAILED', safeError(error)));
  }

  const settings = await inspectSettings({ client, settingsTable, blockers });
  const destination = await inspectDestination({
    client,
    expectedGroupName,
    settings,
    blockers,
  });
  const workflows = await inspectWorkflows({ client, blockers });

  const status = blockers.length === 0 ? 'ready_to_create_disabled_workflows' : 'blocked';
  return freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION,
    status,
    targetGroupName: expectedGroupName,
    aiTable: freeze({
      present: aiTable !== null,
      requiredFieldCount: LARK_NATIVE_AI_REQUIRED_WORKFLOW_FIELDS.length,
      outputFields: aiFieldSummary.filter(({ fieldName }) => AI_OUTPUT_FIELDS.has(fieldName)),
    }),
    notificationLog,
    settings,
    destination,
    workflows,
    blockerCount: blockers.length,
    blockers: blockers.sort(compareBlockers),
    safety: freeze({
      recordReadOnly: true,
      recordWriteCount: 0,
      workflowCreateCount: 0,
      workflowUpdateCount: 0,
      workflowStatusChangeCount: 0,
      automationEnabled: false,
      notificationCount: 0,
      webhookActionCount: 0,
      remoteD1ActionCount: 0,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      providerActionCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }),
  });
}

async function inspectSettings({ client, settingsTable, blockers }) {
  if (!settingsTable) return freeze({
    integrationRowCount: 0,
    distinctDestinationCount: 0,
    destinationKeyHash: null,
    aiEnabledTrueCount: 0,
    notificationEnabledTrueCount: 0,
  });

  const records = requireArray(await client.listRecords({
    tableId: requireText(settingsTable.tableId, 'settingsTable.tableId'),
    pageSize: 500,
    includeRecordMetadata: false,
  }), 'Settings records');
  if (records.length > LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS.maximumSettingsRecords) {
    throw readinessError(
      'Settings inventory exceeded the reviewed bounded read',
      'LARK_NATIVE_AI_WORKFLOW_SETTINGS_LIMIT_EXCEEDED',
      { observed: records.length },
    );
  }

  const integrationRows = records.filter(({ fields }) => (
    textValue(fields?.customer_profile) === 'integration_workspace'
  ));
  if (integrationRows.length === 0) blockers.push(blocker('SETTINGS_INTEGRATION_ROWS_MISSING'));

  const destinations = [...new Set(integrationRows
    .map(({ fields }) => textValue(fields?.group_id))
    .filter(Boolean))];
  if (destinations.length === 0) blockers.push(blocker('SETTINGS_GROUP_ID_MISSING'));
  if (destinations.length > 1) blockers.push(blocker(
    'SETTINGS_GROUP_ID_AMBIGUOUS',
    { distinctDestinationCount: destinations.length },
  ));

  const aiEnabledTrueCount = integrationRows.filter(({ fields }) => (
    booleanValue(fields?.ai_enabled) === true
  )).length;
  const notificationEnabledTrueCount = integrationRows.filter(({ fields }) => (
    booleanValue(fields?.notification_enabled) === true
  )).length;
  if (aiEnabledTrueCount > 0 || notificationEnabledTrueCount > 0) blockers.push(blocker(
    'SETTINGS_ACTIVATION_FLAGS_NOT_ALL_FALSE',
    { aiEnabledTrueCount, notificationEnabledTrueCount },
  ));

  return freeze({
    integrationRowCount: integrationRows.length,
    distinctDestinationCount: destinations.length,
    destinationKeyHash: destinations.length === 1 ? await sha256Hex(destinations[0]) : null,
    aiEnabledTrueCount,
    notificationEnabledTrueCount,
  });
}

async function inspectDestination({ client, expectedGroupName, settings, blockers }) {
  const chats = requireArray(await client.listChats(), 'listChats result');
  const matches = chats.filter(({ name }) => name === expectedGroupName);
  if (matches.length === 0) blockers.push(blocker('TARGET_GROUP_NOT_VISIBLE_TO_APP'));
  if (matches.length > 1) blockers.push(blocker(
    'TARGET_GROUP_IDENTITY_AMBIGUOUS',
    { count: matches.length },
  ));

  const chatId = matches.length === 1 ? requireText(matches[0].chatId, 'targetChat.chatId') : null;
  const chatIdHash = chatId ? await sha256Hex(chatId) : null;
  if (chatIdHash && settings.destinationKeyHash
    && chatIdHash !== settings.destinationKeyHash) blockers.push(blocker(
    'SETTINGS_GROUP_ID_DOES_NOT_MATCH_VISIBLE_GROUP',
  ));

  return freeze({
    exactNameMatchCount: matches.length,
    resolved: chatIdHash !== null,
    destinationKeyHash: chatIdHash,
    settingsMatch: chatIdHash !== null && settings.destinationKeyHash !== null
      ? chatIdHash === settings.destinationKeyHash
      : false,
    rawChatIdPersisted: false,
  });
}

async function inspectWorkflows({ client, blockers }) {
  const inventory = requireArray(await client.listWorkflows(), 'listWorkflows result');
  const items = [];
  for (const title of LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES) {
    const matches = inventory.filter((workflow) => workflow.title === title);
    if (matches.length > 1) {
      blockers.push(blocker('TARGET_WORKFLOW_DUPLICATE', { title, count: matches.length }));
      items.push(freeze({ title, state: 'duplicate', count: matches.length }));
      continue;
    }
    if (matches.length === 0) {
      items.push(freeze({ title, state: 'create_disabled', count: 0 }));
      continue;
    }

    const workflowId = requireText(matches[0].workflowId, `${title}.workflowId`);
    const hydrated = await client.getWorkflow({ workflowId });
    const status = normalizeWorkflowStatus(hydrated?.status ?? matches[0].status);
    if (ENABLED_WORKFLOW_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_WORKFLOW_ALREADY_ENABLED',
      { title, status },
    ));
    if (!DISABLED_WORKFLOW_STATUSES.has(status)) blockers.push(blocker(
      'TARGET_WORKFLOW_STATUS_UNSUPPORTED',
      { title, status },
    ));
    items.push(freeze({ title, state: 'existing', status, count: 1 }));
  }

  return freeze({
    inventoryCount: inventory.length,
    targetCount: items.length,
    plannedCreateDisabledCount: items.filter(({ state }) => state === 'create_disabled').length,
    existingDisabledCount: items.filter(({ state, status }) => (
      state === 'existing' && DISABLED_WORKFLOW_STATUSES.has(status)
    )).length,
    items,
  });
}

function inspectRequiredFields(fields, expectedNames, prefix, blockers) {
  const grouped = groupBy(fields, 'fieldName');
  const summary = [];
  for (const fieldName of expectedNames) {
    const matches = grouped.get(fieldName) ?? [];
    if (matches.length === 0) blockers.push(blocker(`${prefix}_FIELD_MISSING`, { fieldName }));
    if (matches.length > 1) blockers.push(blocker(
      `${prefix}_FIELD_DUPLICATE`,
      { fieldName, count: matches.length },
    ));
    if (matches.length === 1) summary.push(freeze({
      fieldName,
      type: finiteInteger(matches[0].type),
      uiType: optionalText(matches[0].uiType ?? matches[0].ui_type),
    }));
  }
  return freeze(summary);
}

function uniqueNamed(tables, name, prefix, blockers) {
  const matches = tables.filter((table) => table?.name === name);
  if (matches.length === 0) blockers.push(blocker(`${prefix}_MISSING`));
  if (matches.length > 1) blockers.push(blocker(`${prefix}_DUPLICATE`, { count: matches.length }));
  return matches.length === 1 ? matches[0] : null;
}

function groupBy(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const name = optionalText(item?.[key] ?? item?.field_name);
    if (!name) continue;
    grouped.set(name, [...(grouped.get(name) ?? []), item]);
  }
  return grouped;
}

function normalizeWorkflowStatus(value) {
  const text = optionalText(value);
  if (!text) return 'unknown';
  return text.toLowerCase();
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

function compareBlockers(left, right) {
  return left.code.localeCompare(right.code)
    || JSON.stringify(left).localeCompare(JSON.stringify(right));
}

function safeError(error) {
  return freeze({
    code: optionalText(error?.code) ?? 'UNKNOWN',
    message: optionalText(error?.message)?.slice(0, 200) ?? 'Unknown error',
  });
}

function requireClient(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('client is required');
  }
  for (const method of [
    'listTables', 'listFields', 'listRecords', 'listChats', 'listWorkflows', 'getWorkflow',
  ]) if (typeof value[method] !== 'function') throw new TypeError(`client.${method} is required`);
  return value;
}

function finiteInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function requireText(value, field) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${field} is required`);
  return text;
}
function requireArray(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return value;
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freeze(nested);
  return Object.freeze(value);
}

export function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiWorkflowReadinessError';
  error.code = code;
  error.details = freeze({ ...details });
  return error;
}

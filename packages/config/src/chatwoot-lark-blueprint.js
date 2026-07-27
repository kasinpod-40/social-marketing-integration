import { LARK_TABLE_ENV } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';

/** Lark Bitable field types used by this repository. */
export const CHATWOOT_LARK_FIELD_TYPE = Object.freeze({
  TEXT: 1,
  NUMBER: 2,
  SINGLE_SELECT: 3,
  DATETIME: 5,
  CHECKBOX: 7,
});

export const CHATWOOT_LARK_BLUEPRINT_VERSION = 'chatwoot-lark-blueprint-v1';

const T = CHATWOOT_LARK_FIELD_TYPE;
const BOOLEAN_FIELDS = new Set([
  'enable_auto_assignment', 'working_hours_enabled', 'csat_survey_enabled',
  'allow_messages_after_resolved', 'blocked', 'auto_offline', 'confirmed',
  'allow_auto_assign', 'show_on_sidebar', 'active', 'private',
]);
const SELECT_FIELDS = new Set([
  'channel_type', 'medium', 'availability_status', 'source_availability_status',
  'role', 'status', 'priority', 'message_type', 'direction', 'content_type',
  'sender_type', 'event_name', 'data_status',
]);
const TEXT_DATE_FIELDS = new Set(['metric_date']);

const TABLE_SPECS = Object.freeze([
  spec('rawChatwootAccounts', 'RAW_Chatwoot_Accounts', 'account_state_key',
    'account_state_key customer_key account_key external_account_id first_seen_at last_seen_at source_updated_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'account_state_key customer_key account_key external_account_id first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootInboxes', 'RAW_Chatwoot_Inboxes', 'inbox_key',
    'inbox_key customer_key account_key external_account_id external_inbox_id channel_type medium timezone enable_auto_assignment working_hours_enabled csat_survey_enabled allow_messages_after_resolved first_seen_at last_seen_at source_updated_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'inbox_key customer_key account_key external_account_id external_inbox_id first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootContacts', 'RAW_Chatwoot_Contacts', 'contact_key',
    'contact_key customer_key account_key external_account_id external_contact_id blocked availability_status source_availability_status source_created_at last_activity_at source_updated_at first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'contact_key customer_key account_key external_account_id external_contact_id first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootAgents', 'RAW_Chatwoot_Agents', 'agent_key',
    'agent_key customer_key account_key external_account_id external_agent_id role availability_status auto_offline confirmed custom_role_id first_seen_at last_seen_at source_updated_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'agent_key customer_key account_key external_account_id external_agent_id first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootTeams', 'RAW_Chatwoot_Teams', 'team_key',
    'team_key customer_key account_key external_account_id external_team_id allow_auto_assign first_seen_at last_seen_at source_updated_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'team_key customer_key account_key external_account_id external_team_id first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootLabels', 'RAW_Chatwoot_Labels', 'label_key',
    'label_key customer_key account_key external_account_id external_label_id title_hash color show_on_sidebar first_seen_at last_seen_at source_updated_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'label_key customer_key account_key external_account_id external_label_id title_hash first_seen_at last_seen_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootConversations', 'RAW_Chatwoot_Conversations', 'conversation_key',
    'conversation_key customer_key account_key external_account_id external_conversation_id external_inbox_id external_contact_id status priority external_assignee_id external_team_id source_created_at source_updated_at last_activity_at waiting_since source_availability_status message_count incoming_message_count outgoing_message_count private_message_count attachment_message_count reopen_count_delta first_response_seconds first_response_business_seconds resolution_seconds resolution_business_seconds reply_seconds reply_business_seconds metrics_hash metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'conversation_key customer_key account_key external_account_id external_conversation_id source_updated_at message_count incoming_message_count outgoing_message_count private_message_count attachment_message_count reopen_count_delta metrics_hash metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootConversationLabels', 'RAW_Chatwoot_Conversation_Labels', 'conversation_label_key',
    'conversation_label_key conversation_key customer_key account_key external_account_id label_key external_conversation_id external_label_id active observed_at removed_at coverage_run_id sync_run_id created_at updated_at',
    'conversation_label_key conversation_key customer_key account_key external_account_id label_key external_conversation_id external_label_id active observed_at coverage_run_id sync_run_id created_at updated_at'),
  spec('rawChatwootMessageAnalytics', 'RAW_Chatwoot_Message_Analytics', 'message_key',
    'message_key conversation_key customer_key account_key external_account_id external_message_id external_conversation_id external_inbox_id message_type direction content_type private sender_type external_sender_id attachment_count source_created_at source_updated_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at',
    'message_key conversation_key customer_key account_key external_account_id external_message_id external_conversation_id attachment_count source_created_at metadata_hash last_coverage_run_id last_sync_run_id created_at updated_at'),
  spec('rawChatwootReportingEvents', 'RAW_Chatwoot_Reporting_Events', 'reporting_event_key',
    'reporting_event_key customer_key account_key external_account_id external_reporting_event_id event_name value_seconds value_business_seconds external_conversation_id external_inbox_id external_agent_id event_start_at event_end_at source_created_at source_updated_at source_payload_hash coverage_run_id sync_run_id created_at updated_at',
    'reporting_event_key customer_key account_key external_account_id external_reporting_event_id event_name source_payload_hash coverage_run_id sync_run_id created_at updated_at'),
  spec('mktConversations', 'MKT_Conversations', 'conversation_key',
    'conversation_key account_key external_conversation_id external_inbox_id status priority external_assignee_id external_team_id source_created_at source_updated_at last_activity_at message_count incoming_message_count outgoing_message_count reopen_count_delta first_response_seconds resolution_seconds reply_seconds sync_run_id',
    'conversation_key account_key external_conversation_id source_updated_at message_count incoming_message_count outgoing_message_count reopen_count_delta sync_run_id'),
  spec('mktConversationDaily', 'MKT_Conversation_Daily', 'conversation_daily_key',
    'conversation_daily_key customer_key account_key external_account_id external_conversation_id external_inbox_id external_agent_id external_team_id metric_date reporting_timezone status new_conversation_count resolved_count reopened_count incoming_message_count outgoing_message_count private_message_count attachment_message_count first_response_seconds first_response_business_seconds resolution_seconds resolution_business_seconds reply_seconds reply_business_seconds data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at',
    'conversation_daily_key customer_key account_key external_account_id external_conversation_id metric_date reporting_timezone new_conversation_count resolved_count reopened_count incoming_message_count outgoing_message_count private_message_count attachment_message_count data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at'),
  spec('mktAgentDaily', 'MKT_Agent_Daily', 'agent_daily_key',
    'agent_daily_key customer_key account_key external_account_id external_agent_id metric_date reporting_timezone assigned_conversation_count resolved_count reopened_count incoming_message_count outgoing_message_count avg_first_response_seconds avg_resolution_seconds avg_reply_seconds data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at',
    'agent_daily_key customer_key account_key external_account_id external_agent_id metric_date reporting_timezone resolved_count reopened_count incoming_message_count outgoing_message_count data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at'),
  spec('mktInboxDaily', 'MKT_Inbox_Daily', 'inbox_daily_key',
    'inbox_daily_key customer_key account_key external_account_id external_inbox_id metric_date reporting_timezone conversation_count new_conversation_count resolved_count reopened_count incoming_message_count outgoing_message_count avg_first_response_seconds avg_resolution_seconds avg_reply_seconds data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at',
    'inbox_daily_key customer_key account_key external_account_id external_inbox_id metric_date reporting_timezone new_conversation_count resolved_count reopened_count incoming_message_count outgoing_message_count data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at'),
  spec('mktConversationAccountDaily', 'MKT_Conversation_Account_Daily', 'account_daily_key',
    'account_daily_key customer_key account_key external_account_id metric_date reporting_timezone conversation_count new_conversation_count open_conversation_count resolved_conversation_count pending_conversation_count snoozed_conversation_count reopened_count incoming_message_count outgoing_message_count avg_first_response_seconds avg_resolution_seconds avg_reply_seconds active_agent_count active_inbox_count data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at',
    'account_daily_key customer_key account_key external_account_id metric_date reporting_timezone new_conversation_count reopened_count incoming_message_count outgoing_message_count data_status coverage_run_id source_revision fetched_at sync_run_id created_at updated_at'),
]);

export const CHATWOOT_LARK_BLUEPRINT = deepFreeze(TABLE_SPECS.map((spec) => {
  const envName = LARK_TABLE_ENV[spec.key];
  if (!envName) {
    throw permanentError(`Missing Chatwoot Lark environment mapping for ${spec.key}`, {
      code: 'CHATWOOT_LARK_BLUEPRINT_INVALID',
      details: { tableKey: spec.key },
    });
  }
  return {
    key: spec.key,
    logicalName: spec.logicalName,
    createName: spec.logicalName,
    aliases: [spec.logicalName, `📞 ${spec.logicalName}`, `💬 ${spec.logicalName}`],
    envName,
    primaryField: spec.primaryField,
    fields: spec.fieldNames.map((fieldName, index) => blueprintField({
      fieldName,
      order: index + 1,
      primary: fieldName === spec.primaryField,
      required: spec.requiredFields.includes(fieldName),
    })),
  };
}));

export const CHATWOOT_REQUIRED_LARK_TABLE_KEYS = Object.freeze(
  CHATWOOT_LARK_BLUEPRINT.map((table) => table.key),
);

export function validateChatwootLarkBlueprint(schema = CHATWOOT_LARK_BLUEPRINT) {
  if (!Array.isArray(schema) || schema.length !== 15) {
    throw invalid('Chatwoot Lark blueprint must contain exactly 15 tables');
  }
  const tableKeys = new Set();
  const envNames = new Set();
  for (const table of schema) {
    if (tableKeys.has(table.key)) throw invalid(`Duplicate Chatwoot table key: ${table.key}`);
    tableKeys.add(table.key);
    if (envNames.has(table.envName)) throw invalid(`Duplicate Chatwoot Lark env: ${table.envName}`);
    envNames.add(table.envName);
    if (!Array.isArray(table.fields) || table.fields.length === 0) {
      throw invalid(`Chatwoot table ${table.key} has no fields`);
    }
    const primary = table.fields.filter((field) => field.primary === true);
    if (primary.length !== 1 || primary[0].fieldName !== table.primaryField || table.fields[0] !== primary[0]) {
      throw invalid(`Chatwoot table ${table.key} must have its Stable key as the first Primary field`);
    }
    const names = new Set();
    for (const field of table.fields) {
      if (names.has(field.fieldName)) throw invalid(`Duplicate field ${table.key}.${field.fieldName}`);
      names.add(field.fieldName);
      if (!Array.isArray(field.compatibleTypes) || !field.compatibleTypes.includes(field.type)) {
        throw invalid(`Invalid compatible type contract for ${table.key}.${field.fieldName}`);
      }
    }
  }
  return true;
}

function spec(key, logicalName, primaryField, fieldNames, requiredFields) {
  return Object.freeze({
    key,
    logicalName,
    primaryField,
    fieldNames: Object.freeze(words(fieldNames)),
    requiredFields: Object.freeze(words(requiredFields)),
  });
}

function words(value) {
  return String(value).trim().split(/\s+/u);
}

function blueprintField({ fieldName, order, primary, required }) {
  const contract = fieldTypeContract(fieldName, primary);
  return Object.freeze({
    fieldName,
    order,
    type: contract.type,
    uiType: contract.uiType,
    compatibleTypes: Object.freeze(contract.compatibleTypes),
    primary,
    required,
    nullable: !required,
    keyRole: primary ? 'Primary + Stable key' : inferKeyRole(fieldName),
    sourcePath: `Chatwoot normalized write set.${fieldName}`,
    semantics: inferSemantics(fieldName),
    importNote: contract.importNote,
  });
}

function fieldTypeContract(fieldName, primary) {
  if (primary || TEXT_DATE_FIELDS.has(fieldName) || isTextIdentifier(fieldName)) {
    return typeContract(T.TEXT, 'Text', [T.TEXT], 'Keep exact text; never coerce Stable keys or revisions to Number');
  }
  if (BOOLEAN_FIELDS.has(fieldName)) {
    return typeContract(T.CHECKBOX, 'Checkbox', [T.CHECKBOX, T.NUMBER], 'Checkbox preferred; Number 0/1 remains transport-compatible');
  }
  if (SELECT_FIELDS.has(fieldName)) {
    return typeContract(T.SINGLE_SELECT, 'SingleSelect', [T.SINGLE_SELECT, T.TEXT], 'SingleSelect preferred; Text is accepted for existing additive-safe tables');
  }
  if (isTimestamp(fieldName)) {
    return typeContract(T.DATETIME, 'DateTime', [T.DATETIME, T.NUMBER], 'DateTime preferred; Number epoch remains transport-compatible');
  }
  if (isNumeric(fieldName)) {
    return typeContract(T.NUMBER, 'Number', [T.NUMBER], 'Preserve null separately from explicit zero');
  }
  return typeContract(T.TEXT, 'Text', [T.TEXT], 'Text value from the PII-minimized normalized write set');
}

function isTextIdentifier(fieldName) {
  return fieldName.endsWith('_key')
    || fieldName.endsWith('_hash')
    || fieldName.endsWith('_run_id')
    || fieldName === 'coverage_run_id'
    || fieldName === 'sync_run_id'
    || fieldName === 'source_revision'
    || fieldName === 'customer_key'
    || fieldName === 'account_key'
    || fieldName === 'timezone'
    || fieldName === 'reporting_timezone'
    || fieldName === 'color';
}

function isTimestamp(fieldName) {
  return fieldName.endsWith('_at') || fieldName.endsWith('_since');
}

function isNumeric(fieldName) {
  return fieldName.startsWith('external_') && fieldName.endsWith('_id')
    || fieldName.endsWith('_count')
    || fieldName.endsWith('_seconds')
    || fieldName === 'custom_role_id'
    || fieldName === 'reopen_count_delta';
}

function inferKeyRole(fieldName) {
  if (fieldName.endsWith('_key')) return 'Stable relation key';
  if (fieldName.startsWith('external_') && fieldName.endsWith('_id')) return 'External identity component';
  if (fieldName.endsWith('_run_id')) return 'Operational lineage';
  return 'Not a key';
}

function inferSemantics(fieldName) {
  if (fieldName.endsWith('_count')) return 'Observed count; null means unsupported or not proven, zero means Source explicitly observed zero';
  if (fieldName.endsWith('_seconds')) return 'Duration in seconds; nullable when Source does not provide the metric';
  if (isTimestamp(fieldName)) return 'UTC timestamp from Source or connector clock';
  if (BOOLEAN_FIELDS.has(fieldName)) return 'Boolean state from the normalized Chatwoot write set';
  return 'PII-minimized Chatwoot analytics field';
}

function typeContract(type, uiType, compatibleTypes, importNote) {
  return { type, uiType, compatibleTypes, importNote };
}

function invalid(message) {
  return permanentError(message, { code: 'CHATWOOT_LARK_BLUEPRINT_INVALID' });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

validateChatwootLarkBlueprint();

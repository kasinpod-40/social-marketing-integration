import { LARK_NOTIFICATION_LOG_TABLE_NAME } from './lark-notification-log-schema-contract.js';
import { LARK_NATIVE_AI_TARGET_TABLE } from './lark-native-ai-schema-preview.js';

export const LARK_NATIVE_AI_WORKFLOW_READINESS_VERSION =
  'lark_native_ai_workflow_readiness_v1';
export const LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION =
  'RUN_LARK_NATIVE_AI_WORKFLOW_READINESS_V1';
export const LARK_NATIVE_AI_WORKFLOW_READINESS_OUTPUT_ROOT =
  'outputs/lark-native-ai-workflow-readiness';

export { LARK_NATIVE_AI_TARGET_TABLE, LARK_NOTIFICATION_LOG_TABLE_NAME };

export const LARK_NATIVE_AI_SETTINGS_TABLE = '⚙️ MKT_Report_Settings';
export const LARK_NATIVE_AI_TARGET_GROUP_NAME =
  '📊 Social MKT Executive Reports — Integration Workspace';

export const LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES = Object.freeze([
  'AI Materialization → MKT_AI_Report_Runs',
  'Eligible AI Run → Lark Group Notification',
]);

export const LARK_NATIVE_AI_REQUIRED_WORKFLOW_FIELDS = Object.freeze([
  'ai_run_key',
  'scope_type',
  'window_days',
  'generation_status',
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
  'severity',
  'notification_eligible',
  'notification_reason',
  'dedupe_key',
  'preview_mode',
  'sent_to_group',
  'sent_at',
]);

export const LARK_NATIVE_AI_REQUIRED_SETTINGS_FIELDS = Object.freeze([
  'customer_profile',
  'enabled',
  'ai_enabled',
  'notification_enabled',
  'group_id',
  'language',
  'timezone',
]);

export const LARK_NATIVE_AI_WORKFLOW_READINESS_LIMITS = Object.freeze({
  maximumTableReads: 8,
  maximumFieldReads: 8,
  maximumViewListReads: 8,
  maximumViewGetReads: 32,
  maximumRecordReads: 4,
  maximumWorkflowListReads: 5,
  maximumWorkflowGetReads: 4,
  maximumChatListReads: 5,
  maximumSettingsRecords: 500,
});

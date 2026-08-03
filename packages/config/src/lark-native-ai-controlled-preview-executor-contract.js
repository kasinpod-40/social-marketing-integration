import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_PLAN_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SUPPORTED_WINDOWS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE,
} from './lark-native-ai-controlled-preview-contract.js';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_CONTRACT_VERSION =
  'lark_native_ai_controlled_preview_executor_v1';
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTION_PLAN_SCHEMA_VERSION =
  'lark_native_ai_controlled_preview_execution_plan_v1';
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_READINESS_PLAN_SCHEMA_VERSION =
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_PLAN_SCHEMA_VERSION;
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_TARGET_TABLE =
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE;
export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_WINDOWS =
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SUPPORTED_WINDOWS;

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_CHANNEL_KEYS = Object.freeze([
  ...LARK_NATIVE_AI_CONTROLLED_PREVIEW_ROW_CHANNELS.map(({ channelKey }) => channelKey),
  'executive',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_STATUSES = Object.freeze([
  'blocked',
  'ready_to_apply',
  'zero_drift',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_ACTIONS = Object.freeze([
  'create',
  'update',
  'no_op',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_AI_OUTPUT_FIELDS = Object.freeze([
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_STATE_FIELDS = Object.freeze([
  'generation_status',
  'failure_code',
]);

const excluded = new Set([
  ...LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_AI_OUTPUT_FIELDS,
  ...LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_STATE_FIELDS,
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_MANAGED_FIELDS = Object.freeze(
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS.filter((field) => !excluded.has(field)),
);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_OUTPUT_INVALIDATING_FIELDS = Object.freeze([
  'report_id',
  'platforms',
  'report_type',
  'metric_summary_json',
  'scope_type',
  'channel_key',
  'capability',
  'account_id',
  'window_days',
  'data_status',
  'readiness_status',
  'coverage_rate',
  'source_report_ids_json',
  'source_report_checksum',
  'channel_status_vector_json',
  'severity',
  'template_version',
  'generated_at',
]);

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_REQUIRED_FIELDS =
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS;

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_LIMITS = Object.freeze({
  expectedWindows: 4,
  expectedRowsPerWindow: 10,
  expectedTotalRows: 40,
  maximumWriteCount: 40,
  maximumExistingRecords: 10_000,
  maximumBlockers: 200,
});

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_SAFETY_FIELDS = Object.freeze({
  preview_mode: true,
  notification_eligible: false,
  sent_to_group: false,
  sent_at: null,
});

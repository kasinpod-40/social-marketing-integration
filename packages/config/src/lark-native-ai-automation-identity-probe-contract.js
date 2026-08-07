export const LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_VERSION =
  'lark_native_ai_automation_identity_probe_v1';

export const LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_CONFIRMATION =
  'READ_LARK_NATIVE_AI_AUTOMATION_IDENTITIES_V1';

export const LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_OUTPUT_ROOT =
  'outputs/lark-native-ai-automation-identity-probe';

export const LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_TITLES = Object.freeze([
  'AI Materialization → MKT_AI_Report_Runs',
  'Eligible AI Run → Lark Group Notification',
]);

export const LARK_NATIVE_AI_AUTOMATION_IDENTITY_PROBE_LIMITS = Object.freeze({
  maximumAutomationListReads: 1,
  maximumWorkflowGetReads: 2,
  maximumTokenReads: 2,
});

export const LARK_NATIVE_AI_AUTOMATION_INACTIVE_STATUSES = Object.freeze([
  'disable',
  'disabled',
  'inactive',
  'off',
  'draft',
]);

export const LARK_NATIVE_AI_AUTOMATION_ACTIVE_STATUSES = Object.freeze([
  'enable',
  'enabled',
  'active',
  'running',
  'on',
]);

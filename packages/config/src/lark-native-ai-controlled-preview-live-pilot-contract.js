import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_TARGET_TABLE,
} from './lark-native-ai-controlled-preview-executor-contract.js';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONTRACT_VERSION =
  'lark_native_ai_controlled_preview_live_pilot_v1';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION =
  'lark_native_ai_controlled_preview_live_pilot_input_v1';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_EVIDENCE_SCHEMA_VERSION =
  'lark_native_ai_controlled_preview_live_pilot_evidence_v1';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_TARGET_TABLE =
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXECUTOR_TARGET_TABLE;

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_CONFIRMATION =
  'APPLY_LARK_NATIVE_AI_CONTROLLED_PREVIEW_40_ROWS';

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_LIMITS = Object.freeze({
  expectedRows: 40,
  maximumRecordWrites: 40,
  maximumBatchWriteRequests: 2,
  maximumRecordSearchRequests: 4,
  maximumTableReadRequests: 1,
  maximumTokenRequests: 2,
});

export const LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_SAFETY = Object.freeze({
  previewMode: true,
  notificationEligible: false,
  sentToGroup: false,
  deleteAuthorized: false,
  schemaMutationAuthorized: false,
  aiCallAuthorized: false,
  automationAuthorized: false,
  notificationAuthorized: false,
  scheduleEnabled: false,
  production: 'BLOCKED',
});

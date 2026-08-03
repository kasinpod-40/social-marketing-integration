import {
  LARK_NATIVE_AI_SETTINGS_TABLE,
  LARK_NATIVE_AI_TARGET_GROUP_NAME,
} from './lark-native-ai-workflow-readiness-contract.js';

export const LARK_NATIVE_AI_DESTINATION_BINDING_VERSION =
  'lark_native_ai_destination_binding_v1';
export const LARK_NATIVE_AI_DESTINATION_BINDING_CONFIRMATION =
  'BIND_LARK_NATIVE_AI_DESTINATION_V1';
export const LARK_NATIVE_AI_DESTINATION_BINDING_OUTPUT_ROOT =
  'outputs/lark-native-ai-destination-binding';

export { LARK_NATIVE_AI_SETTINGS_TABLE, LARK_NATIVE_AI_TARGET_GROUP_NAME };

export const LARK_NATIVE_AI_DESTINATION_BINDING_REQUIRED_FIELDS = Object.freeze([
  'customer_profile',
  'group_id',
  'ai_enabled',
  'notification_enabled',
]);

export const LARK_NATIVE_AI_DESTINATION_BINDING_LIMITS = Object.freeze({
  maximumTableReads: 4,
  maximumFieldReads: 4,
  maximumRecordReads: 4,
  maximumChatListReads: 5,
  maximumBatchUpdateRequests: 1,
  maximumSettingsRecords: 500,
  maximumRecordWrites: 500,
  readAfterWriteDelayMs: 10_000,
});

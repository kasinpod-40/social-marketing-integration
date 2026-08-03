import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES,
} from './lark-native-ai-workflow-readiness-contract.js';

export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION =
  'lark_native_ai_disabled_workflows_v1';
export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_CONFIRMATION =
  'CREATE_LARK_NATIVE_AI_DISABLED_WORKFLOWS_V1';
export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_OUTPUT_ROOT =
  'outputs/lark-native-ai-disabled-workflows';

export const LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS = Object.freeze(
  LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES.map((title) => Object.freeze({
    title,
    steps: Object.freeze([]),
    intent: title.startsWith('AI Materialization')
      ? 'native_ai_materialization_shell'
      : 'group_notification_shell',
  })),
);

export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_LIMITS = Object.freeze({
  maximumWorkflowCreates: 2,
  maximumWorkflowListReads: 8,
  maximumWorkflowGetReads: 8,
  maximumTableReads: 16,
  maximumFieldReads: 16,
  maximumViewListReads: 16,
  maximumViewGetReads: 64,
  maximumRecordReads: 8,
  maximumChatListReads: 10,
});

import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES,
} from './lark-native-ai-workflow-readiness-contract.js';

export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION =
  'lark_native_ai_disabled_workflows_v1';
export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_CONFIRMATION =
  'CREATE_LARK_NATIVE_AI_DISABLED_WORKFLOWS_V1';
export const LARK_NATIVE_AI_DISABLED_WORKFLOWS_OUTPUT_ROOT =
  'outputs/lark-native-ai-disabled-workflows';
export const LARK_NATIVE_AI_INACTIVE_PLACEHOLDER_DELAY_MINUTES = 1;

const PLACEHOLDER_SPECS = Object.freeze([
  Object.freeze({
    title: LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES[0],
    intent: 'native_ai_materialization_inactive_placeholder',
    triggerTable: '🧾 MKT_Report_Snapshots',
    watchedField: 'report_id',
  }),
  Object.freeze({
    title: LARK_NATIVE_AI_DISABLED_WORKFLOW_TITLES[1],
    intent: 'group_notification_inactive_placeholder',
    triggerTable: '🧠 MKT_AI_Report_Runs',
    watchedField: 'ai_run_key',
  }),
]);

export const LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS = Object.freeze(
  PLACEHOLDER_SPECS.map((spec) => Object.freeze({
    ...spec,
    steps: Object.freeze([
      Object.freeze({
        id: 'trigger_new_record',
        type: 'AddRecordTrigger',
        title: 'Inactive placeholder: new record',
        next: 'delay_one_minute',
        data: Object.freeze({
          table_name: spec.triggerTable,
          watched_field_name: spec.watchedField,
          trigger_control_list: Object.freeze([]),
          condition_list: null,
        }),
      }),
      Object.freeze({
        id: 'delay_one_minute',
        type: 'Delay',
        title: 'Inactive placeholder: delay 1 minute',
        next: null,
        data: Object.freeze({
          duration: LARK_NATIVE_AI_INACTIVE_PLACEHOLDER_DELAY_MINUTES,
        }),
      }),
    ]),
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

export const LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_VERSION =
  'lark_native_ai_disabled_configuration_preview_v1';
export const LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_OUTPUT_ROOT =
  'outputs/lark-native-ai-disabled-configuration-preview';

export const LARK_NATIVE_AI_EXECUTIVE_GROUP_NAME = 'Social MKT Executive Reports';
export const LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH =
  '7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9';

export const LARK_NATIVE_AI_DISABLED_CONFIGURATION_PERMISSION_BUNDLE = Object.freeze([
  'base:workflow:read',
  'base:workflow:create',
  'base:workflow:update',
  'base:workflow:write',
]);

export const LARK_NATIVE_AI_NOTIFICATION_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const LARK_NATIVE_AI_NOTIFICATION_SEVERITIES = Object.freeze([
  'info',
  'warning',
  'critical',
]);
export const LARK_NATIVE_AI_NOTIFICATION_PAYLOAD_MAX_BYTES = 24_000;

const AI_RUN_TABLE = '🧠 MKT_AI_Report_Runs';
const REPORT_SNAPSHOT_TABLE = '🧾 MKT_Report_Snapshots';
const REPORT_SETTINGS_TABLE = '⚙️ MKT_Report_Settings';
const NOTIFICATION_LOG_TABLE = '🔔 MKT_Notification_Log';

export const LARK_NATIVE_AI_DISABLED_CONFIGURATION_WORKFLOWS = Object.freeze([
  deepFreeze({
    title: 'AI Materialization → MKT_AI_Report_Runs',
    status: 'inactive',
    replacesPlaceholder: Object.freeze({
      triggerTable: REPORT_SNAPSHOT_TABLE,
      watchedField: 'report_id',
      action: 'delay',
      delayMinutes: 1,
    }),
    finalTrigger: Object.freeze({
      type: 'new_or_updated_record_matches_conditions',
      table: AI_RUN_TABLE,
      watchedFields: Object.freeze([
        'generation_status',
        'readiness_status',
        'metric_summary_json',
        'preview_mode',
        'insight_summary',
        'strengths',
        'weaknesses',
        'recommendations',
      ]),
      conditions: Object.freeze([
        condition('generation_status', 'equals', 'pending'),
        condition('readiness_status', 'in', Object.freeze([
          'report_available',
          'report_partial',
        ])),
        condition('metric_summary_json', 'is_not_empty', true),
        condition('preview_mode', 'equals', false),
        condition('insight_summary', 'is_empty', true),
        condition('strengths', 'is_empty', true),
        condition('weaknesses', 'is_empty', true),
        condition('recommendations', 'is_empty', true),
      ]),
    }),
    actions: Object.freeze([
      action('lark_native_ai_generate_structured_text', Object.freeze({
        inputFields: Object.freeze([
          'metric_summary_json',
          'readiness_status',
          'readiness_message',
          'coverage_rate',
          'channel_status_vector_json',
          'window_days',
        ]),
        outputFields: Object.freeze([
          'insight_summary',
          'strengths',
          'weaknesses',
          'recommendations',
        ]),
        promptVersion: 'lark_native_ai_prompt_v1',
        sourcePolicy: 'validated_shared_report_only',
      })),
      action('update_current_record', Object.freeze({
        set: Object.freeze({
          generation_status: 'generated',
          failure_code: null,
          generated_at: 'automation_now',
        }),
      })),
    ]),
    forbiddenActionTypes: Object.freeze([
      'send_lark_message',
      'create_notification_log',
      'enable_automation',
      'schedule',
      'webhook',
      'http_request',
    ]),
  }),
  deepFreeze({
    title: 'Eligible AI Run → Lark Group Notification',
    status: 'inactive',
    replacesPlaceholder: Object.freeze({
      triggerTable: AI_RUN_TABLE,
      watchedField: 'ai_run_key',
      action: 'delay',
      delayMinutes: 1,
    }),
    finalTrigger: Object.freeze({
      type: 'new_or_updated_record_matches_conditions',
      table: AI_RUN_TABLE,
      watchedFields: Object.freeze([
        'report_id',
        'scope_type',
        'generation_status',
        'notification_eligible',
        'preview_mode',
        'sent_to_group',
        'dedupe_key',
      ]),
      conditions: Object.freeze([
        condition('report_id', 'is_not_empty', true),
        condition('scope_type', 'equals', 'executive'),
        condition('generation_status', 'equals', 'generated'),
        condition('notification_eligible', 'equals', true),
        condition('preview_mode', 'equals', false),
        condition('sent_to_group', 'equals', false),
        condition('dedupe_key', 'is_not_empty', true),
      ]),
    }),
    actions: Object.freeze([
      action('find_exact_record', Object.freeze({
        table: REPORT_SNAPSHOT_TABLE,
        matchFields: Object.freeze(['report_id']),
        requireCount: 1,
        readFields: Object.freeze([
          'report_setting_key',
          'customer_profile',
          'period_start',
          'period_end',
        ]),
      })),
      action('find_exact_record', Object.freeze({
        table: REPORT_SETTINGS_TABLE,
        identitySource: REPORT_SNAPSHOT_TABLE,
        matchFields: Object.freeze([
          'report_setting_key',
          'customer_profile',
          'enabled=true',
          'notification_enabled=true',
          'group_id is not empty',
        ]),
        requireCount: 1,
      })),
      action('find_exact_record', Object.freeze({
        table: NOTIFICATION_LOG_TABLE,
        matchFields: Object.freeze(['notification_attempt_key']),
        requireCount: 0,
        existingRecordPolicy: 'dedupe_without_send',
      })),
      action('add_notification_log_record', Object.freeze({
        table: NOTIFICATION_LOG_TABLE,
        attemptStatus: 'pending',
        previewMode: false,
      })),
      action('send_lark_message', Object.freeze({
        destinationSource: `${REPORT_SETTINGS_TABLE}.group_id`,
        exactDestinationName: LARK_NATIVE_AI_EXECUTIVE_GROUP_NAME,
        destinationKeyHash: LARK_NATIVE_AI_EXECUTIVE_DESTINATION_KEY_HASH,
        messageTemplateVersion: 'executive_report_notification_v1',
      })),
      action('update_notification_log_record', Object.freeze({
        set: Object.freeze({
          attempt_status: 'sent',
          sent_at: 'automation_now',
        }),
      })),
      action('update_current_record', Object.freeze({
        set: Object.freeze({
          sent_to_group: true,
          sent_at: 'automation_now',
        }),
      })),
    ]),
    failurePolicy: Object.freeze({
      failClosedOnMissingOrMultipleLookup: true,
      preserveSentFalseOnFailure: true,
      logFailureWithoutRawDestination: true,
      automaticRetry: false,
    }),
    forbiddenActionTypes: Object.freeze([
      'enable_automation',
      'schedule',
      'webhook',
      'http_request',
      'external_ai_provider',
    ]),
  }),
]);

export const LARK_NATIVE_AI_DISABLED_CONFIGURATION_SAFETY = Object.freeze({
  repositoryOnly: true,
  remoteLarkRead: 0,
  remoteLarkWrite: 0,
  workflowCreate: 0,
  workflowUpdate: 0,
  workflowStatusChange: 0,
  automationEnabled: false,
  nativeAiCall: 0,
  recordWrite: 0,
  notificationSend: 0,
  webhookAction: 0,
  remoteD1Action: 0,
  queueAction: 0,
  workerDeployment: 0,
  providerAction: 0,
  scheduleEnabled: false,
  production: 'BLOCKED',
});

function condition(field, operator, value) {
  return Object.freeze({ field, operator, value });
}

function action(type, config) {
  return Object.freeze({ type, config });
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}

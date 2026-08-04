export const LARK_NATIVE_AI_NOTIFICATION_DEDUPE_PREVIEW_VERSION =
  'lark_native_ai_disabled_configuration_preview_v6';

export const LARK_NATIVE_AI_NOTIFICATION_DEDUPE_GATE_AUTHORITY = deepFreeze({
  source: 'user_confirmed_lark_base_ui',
  observedOn: '2026-08-04',
  workflowTitle: 'Eligible AI Run → Lark Group Notification',
  actionType: 'Find records',
  availableNoRecordPolicies: Object.freeze(['continue', 'stop']),
  requiredExistingRecordPolicy: 'stop_when_records_found',
  requiredNoRecordPolicy: 'continue_when_no_records_found',
  supported: false,
  liveConfigurationSupported: false,
  safeState: 'inactive_placeholder',
  blockerCode: 'LARK_NATIVE_NOTIFICATION_DEDUPE_GATE_UNSUPPORTED',
  reason: 'The current Lark Base Automation UI can stop only when no records are found. It cannot stop when an existing notification_attempt_key is found, so the exact duplicate-send gate cannot be represented safely.',
  forbiddenWorkarounds: Object.freeze([
    'http_request',
    'anycross',
    'webhook',
    'external_worker',
    'external_provider',
    'set_sent_to_group_before_send',
    'save_without_existing_record_stop_gate',
  ]),
});

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}

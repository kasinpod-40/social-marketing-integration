export const LARK_NOTIFICATION_LOG_SCHEMA_CONTRACT_VERSION = 'lark_notification_log_schema_v1';
export const LARK_NOTIFICATION_LOG_TABLE_NAME = '🔔 MKT_Notification_Log';
export const LARK_NOTIFICATION_LOG_LEGACY_TABLE_NAME = 'MKT_Notification_Log';
export const LARK_NOTIFICATION_LOG_DEFAULT_VIEW_NAME = '🌐 All Notification Attempts';
export const LARK_NOTIFICATION_LOG_APPLY_CONFIRMATION = 'APPLY_LARK_NOTIFICATION_LOG_SCHEMA_V1';
export const LARK_NOTIFICATION_LOG_OUTPUT_ROOT = 'outputs/lark-notification-log-schema';

const TYPE = Object.freeze({
  Text: Object.freeze({ type: 1, uiType: 'Text' }),
  SingleSelect: Object.freeze({ type: 3, uiType: 'SingleSelect' }),
  DateTime: Object.freeze({ type: 5, uiType: 'DateTime' }),
  Checkbox: Object.freeze({ type: 7, uiType: 'Checkbox' }),
});

export const LARK_NOTIFICATION_LOG_FIELDS = Object.freeze([
  field('notification_attempt_key', 'Text', 'Stable key ของ Notification attempt; เป็น Primary field และห้ามซ้ำ'),
  field('ai_run_key', 'Text', 'Stable key ของ AI run ต้นทาง'),
  field('dedupe_key', 'Text', 'Deterministic key ที่ใช้ป้องกันการส่งซ้ำ'),
  field('destination_key_hash', 'Text', 'Hash ของปลายทางเท่านั้น ห้ามเก็บ Group ID หรือ Webhook URL'),
  field('window_days', 'SingleSelect', 'ช่วงรายงานที่ข้อความอ้างอิง', ['1', '3', '7', '30']),
  field('period_start', 'DateTime', 'เวลาเริ่มต้นของช่วงรายงาน'),
  field('period_end', 'DateTime', 'เวลาสิ้นสุดของช่วงรายงาน'),
  field('severity', 'SingleSelect', 'ระดับความสำคัญที่ระบบกำหนดแบบ deterministic', [
    'info', 'warning', 'critical',
  ]),
  field('payload_checksum', 'Text', 'SHA-256 ของ payload ที่ผ่านการ redact แล้ว'),
  field('attempt_status', 'SingleSelect', 'สถานะวงจรชีวิตของ Notification attempt', [
    'pending', 'sending', 'previewed', 'sent', 'deduped', 'blocked', 'failed',
  ]),
  field('attempted_at', 'DateTime', 'เวลาที่เริ่มพยายาม Preview หรือส่งข้อความ'),
  field('sent_at', 'DateTime', 'เวลาที่ส่งสำเร็จ; ว่างเมื่อยังไม่ส่ง'),
  field('failure_code', 'Text', 'Error code แบบไม่เปิดเผย Secret'),
  field('redacted_failure_message', 'Text', 'ข้อความผิดพลาดที่ตัด Secret/ปลายทาง/ข้อมูลส่วนบุคคลแล้ว'),
  field('preview_mode', 'Checkbox', 'จริงเมื่อเป็น Preview และต้องไม่ส่งข้อความจริง'),
]);

export const LARK_NOTIFICATION_LOG_VIEWS = Object.freeze([
  view(LARK_NOTIFICATION_LOG_DEFAULT_VIEW_NAME, { mode: 'all_rows' }),
  view('🧪 Preview Attempts', {
    mode: 'all_of',
    conditions: [condition('preview_mode', 'equals', [true])],
  }),
  view('⏳ Pending / Sending', {
    mode: 'any_of',
    conditions: [condition('attempt_status', 'in', ['pending', 'sending'])],
  }),
  view('✅ Sent', {
    mode: 'all_of',
    conditions: [condition('attempt_status', 'equals', ['sent'])],
  }),
  view('❌ Failed', {
    mode: 'all_of',
    conditions: [condition('attempt_status', 'equals', ['failed'])],
  }),
  view('🛑 Blocked / Deduped', {
    mode: 'any_of',
    conditions: [condition('attempt_status', 'in', ['blocked', 'deduped'])],
  }),
]);

export const LARK_NOTIFICATION_LOG_EXPECTED_COUNTS = Object.freeze({
  fields: LARK_NOTIFICATION_LOG_FIELDS.length,
  views: LARK_NOTIFICATION_LOG_VIEWS.length,
  maximumCreateTableRequests: 1,
  maximumCreateFieldRequests: LARK_NOTIFICATION_LOG_FIELDS.length - 1,
  maximumCreateViewRequests: LARK_NOTIFICATION_LOG_VIEWS.length - 1,
  maximumUpdateViewRequests: LARK_NOTIFICATION_LOG_VIEWS.length - 1,
});

export function buildLarkNotificationLogCreateTableFields() {
  return LARK_NOTIFICATION_LOG_FIELDS.map((item, index) => Object.freeze({
    fieldName: item.fieldName,
    type: item.type,
    uiType: item.uiType,
    description: item.description,
    ...(item.options ? {
      property: {
        options: item.options.map((name, optionIndex) => ({
          name,
          color: optionIndex % 10,
        })),
      },
    } : item.fieldType === 'DateTime' ? {
      property: {
        date_formatter: 'yyyy-MM-dd HH:mm',
        auto_fill: false,
      },
    } : {}),
    isPrimary: index === 0,
  }));
}

function field(fieldName, fieldType, description, options = null) {
  const definition = TYPE[fieldType];
  if (!definition) throw new TypeError(`Unsupported Lark Notification Log field type: ${fieldType}`);
  return Object.freeze({
    fieldName,
    fieldType,
    type: definition.type,
    uiType: definition.uiType,
    description,
    options: options ? Object.freeze([...options]) : null,
    required: true,
  });
}

function condition(fieldName, operator, values) {
  return Object.freeze({ fieldName, operator, values: Object.freeze([...values]) });
}

function view(viewName, logicalFilter) {
  const frozenFilter = Object.freeze({
    ...logicalFilter,
    ...(logicalFilter.conditions
      ? { conditions: Object.freeze([...logicalFilter.conditions]) }
      : {}),
  });
  return Object.freeze({ viewName, viewType: 'grid', logicalFilter: frozenFilter });
}

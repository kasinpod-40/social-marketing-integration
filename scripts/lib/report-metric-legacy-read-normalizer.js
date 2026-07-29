import { DASHBOARD_REPORT_PRESET_DAYS } from '../../packages/config/src/report-settings.seed.js';
import { readLarkText } from '../../packages/connectors/src/shared/lark-cell-value.js';

const WINDOW_FIELD_NAMES = new Set([
  'window_days',
  '__mkt_legacy_window_days_single_select_v1',
]);

/**
 * Normalize เฉพาะ read model ที่ส่งเข้า Migration; ไม่เขียนหรือแก้ Legacy cell จริง.
 * รองรับรูปแบบที่มี semantic ชัดเจนว่าเป็นจำนวนวันของ canonical Report preset เท่านั้น.
 */
export function createReportMetricLegacyReadNormalizer(client) {
  if (typeof client?.listRecords !== 'function') {
    throw new TypeError('Report Metric legacy read normalizer requires client.listRecords');
  }
  return new Proxy(client, {
    get(target, property) {
      if (property === 'listRecords') {
        return async (input) => {
          const records = await target.listRecords(input);
          return Object.freeze(records.map(normalizeRecord));
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export function normalizeLegacyReportWindowDays(value) {
  // SingleSelect ที่ผิดปกติและมีหลาย entry ต้องคง Shape เดิมไว้ให้ Core ปฏิเสธ;
  // ห้าม concatenate จนบังเอิญกลายเป็น preset อื่น เช่น ["3", "0"] -> "30".
  if (Array.isArray(value) && value.length > 1) return value;
  const text = readLarkText(value, { allowNull: true, label: 'legacy window_days' });
  if (text === null) return null;
  const normalized = text.trim().toLowerCase();
  const match = /^(?:(?:rolling:)?([1-9]\d*)d|([1-9]\d*)\s*days?|([1-9]\d*))$/u.exec(normalized);
  if (!match) return value;
  const digits = match[1] ?? match[2] ?? match[3];
  const number = Number(digits);
  if (!Number.isSafeInteger(number) || !DASHBOARD_REPORT_PRESET_DAYS.includes(number)) return value;
  return String(number);
}

function normalizeRecord(record) {
  const fields = { ...(record?.fields ?? {}) };
  for (const [fieldName, value] of Object.entries(fields)) {
    if (WINDOW_FIELD_NAMES.has(fieldName.trim().toLowerCase())) {
      fields[fieldName] = normalizeLegacyReportWindowDays(value);
    }
  }
  return Object.freeze({
    ...record,
    fields: Object.freeze(fields),
  });
}

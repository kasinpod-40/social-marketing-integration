import { parseReportMaterializationPayload } from '../../application/src/reports/report-materialization-payload.js';
import { validateStorageRow } from '../../application/src/storage/marketing-history-contract.js';
import { createStableFingerprint } from '../../shared/src/hash/stable-fingerprint.js';
import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

/** Dashboard/AI reader. This class intentionally exposes no detailed-fact query methods. */
export class D1ReportMaterializationReader {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async readById(reportId) {
    const row = await this.#first(
      'SELECT * FROM report_materializations WHERE report_id = ?',
      [requireText(reportId, 'reportId')],
    );
    return row ? validateRow(row) : null;
  }

  /**
   * Read the newest exact period identity without assuming the formula version.
   *
   * Historical materializations can legitimately retain an older formula row while a
   * newer deployed Report contract writes the same setting/period under a new formula
   * version. The period dimensions remain the immutable lookup boundary; generated_at
   * selects the authoritative latest formula revision for that exact boundary.
   */
  async readLatestForPeriod(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const platformScope = requireText(input.platformScope, 'platformScope');
    const reportSettingKey = requireText(input.reportSettingKey, 'reportSettingKey');
    const periodKind = requireText(input.periodKind, 'periodKind');
    const periodStart = requireDateOnly(input.periodStart, 'periodStart');
    const periodEnd = requireDateOnly(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) throw new RangeError('periodStart must not be after periodEnd');
    const windowDays = optionalPositiveInteger(input.windowDays, 'windowDays');
    const windowCondition = windowDays === null ? 'window_days IS NULL' : 'window_days = ?';
    const bindings = [
      customerKey,
      accountKey,
      platformScope,
      reportSettingKey,
      periodKind,
      periodStart,
      periodEnd,
      ...(windowDays === null ? [] : [windowDays]),
    ];
    const row = await this.#first(`
      SELECT * FROM report_materializations
      WHERE customer_key = ? AND account_key = ? AND platform_scope = ?
        AND report_setting_key = ? AND period_kind = ?
        AND period_start = ? AND period_end = ? AND ${windowCondition}
      ORDER BY generated_at DESC, report_id ASC
      LIMIT 1
    `, bindings);
    return row ? validateRow(row) : null;
  }

  async readLatest(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const platformScope = requireText(input.platformScope, 'platformScope');
    const reportSettingKey = optionalText(input.reportSettingKey);
    const conditions = ['customer_key = ?', 'account_key = ?', 'platform_scope = ?'];
    const bindings = [customerKey, accountKey, platformScope];
    if (reportSettingKey) {
      conditions.push('report_setting_key = ?');
      bindings.push(reportSettingKey);
    }
    const row = await this.#first(`
      SELECT * FROM report_materializations
      WHERE ${conditions.join(' AND ')}
      ORDER BY period_end DESC, generated_at DESC, report_id ASC
      LIMIT 1
    `, bindings);
    return row ? validateRow(row) : null;
  }

  async #first(sql, bindings) {
    try {
      const row = await this.db.prepare(sql).bind(...bindings).first();
      return row ? Object.freeze({ ...row }) : null;
    } catch (cause) {
      throw transientError('Failed to read report materialization', {
        code: 'D1_REPORT_MATERIALIZATION_READ_FAILED',
        cause,
        details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
      });
    }
  }
}

async function validateRow(row) {
  const validatedRow = validateStorageRow('report_materializations', row);

  // Checksum protects the exact JSON contract that was persisted. Validate it before
  // the current parser adds backward-compatible defaults such as `collections: {}`;
  // otherwise additive schema evolution would make an unchanged historical row look tampered.
  const storedPayload = parseStoredPayloadJson(validatedRow.payload_json, validatedRow.report_id);
  const checksum = await createStableFingerprint(storedPayload);
  if (checksum !== validatedRow.payload_checksum) {
    throw permanentError('Report materialization checksum does not match payload', {
      code: 'REPORT_MATERIALIZATION_CHECKSUM_MISMATCH',
      details: { reportId: validatedRow.report_id },
    });
  }

  const payload = parseReportMaterializationPayload(validatedRow.payload_json);
  if (payload.platformScope !== validatedRow.platform_scope
    || payload.reportType !== validatedRow.report_type
    || payload.period.periodKind !== validatedRow.period_kind
    || payload.period.windowDays !== (validatedRow.window_days ?? null)
    || payload.period.periodStart !== validatedRow.period_start
    || payload.period.periodEnd !== validatedRow.period_end
    || payload.period.compareStart !== (validatedRow.compare_start ?? null)
    || payload.period.compareEnd !== (validatedRow.compare_end ?? null)
    || payload.dataStatus !== validatedRow.data_status
    || payload.coverageRate !== (validatedRow.coverage_rate ?? null)
    || payload.generatedAt !== validatedRow.generated_at) {
    throw permanentError('Report materialization row metadata does not match payload', {
      code: 'REPORT_MATERIALIZATION_METADATA_MISMATCH',
      details: { reportId: validatedRow.report_id },
    });
  }
  return Object.freeze({ row: validatedRow, payload });
}

function parseStoredPayloadJson(value, reportId) {
  try {
    return JSON.parse(value);
  } catch (cause) {
    throw permanentError('Report materialization payload JSON is invalid', {
      code: 'REPORT_MATERIALIZATION_PAYLOAD_INVALID',
      cause,
      details: { reportId },
    });
  }
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1ReportMaterializationReader requires a D1 binding');
  return value;
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireDateOnly(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  return text;
}
function optionalPositiveInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${fieldName} must be a positive integer or null`);
  return value;
}

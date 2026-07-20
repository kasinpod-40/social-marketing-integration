/*
 * Normalize Organic content batch แบบไม่ผูก Platform
 * Adapter ของแต่ละ Platform รับผิดชอบ Source contract ส่วนฟังก์ชันนี้ดูแล Error isolation และ Stable-key dedupe
 */
export function normalizeOrganicContentBatch(input = {}) {
  const rawRows = requireArray(input.rawRows, 'rawRows');
  const normalizeRow = requireFunction(input.normalizeRow, 'normalizeRow');
  const readSourceIdentity = typeof input.readSourceIdentity === 'function'
    ? input.readSourceIdentity
    : () => null;
  const contentByKey = new Map();
  const dailySnapshotByKey = new Map();
  const skippedRows = [];
  const sourceIdentities = new Set();
  let duplicateContentRows = 0;
  let duplicateDailyRows = 0;

  for (let rowIndex = 0; rowIndex < rawRows.length; rowIndex += 1) {
    try {
      const normalized = requireNormalizedResult(normalizeRow(rawRows[rowIndex], rowIndex));
      const sourceIdentity = normalizeOptionalText(readSourceIdentity(normalized));
      if (sourceIdentity) sourceIdentities.add(sourceIdentity);

      const contentKey = normalized.content.content_key;
      if (contentByKey.has(contentKey)) duplicateContentRows += 1;
      // Policy กลางตรงกับ Sync Engine: เมื่อไม่มี Source update timestamp ให้ลำดับหลังชนะอย่าง deterministic.
      // Connector readiness ต้องใช้ duplicate count เป็น Contract warning/error แทนการซ่อนความกำกวม.
      contentByKey.set(contentKey, normalized.content);

      const dailyKey = normalized.dailySnapshot.content_daily_key;
      if (dailySnapshotByKey.has(dailyKey)) duplicateDailyRows += 1;
      dailySnapshotByKey.set(dailyKey, normalized.dailySnapshot);
    } catch (error) {
      skippedRows.push(Object.freeze({
        rowIndex,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return Object.freeze({
    contentRows: Object.freeze([...contentByKey.values()]),
    dailySnapshotRows: Object.freeze([...dailySnapshotByKey.values()]),
    skippedRows: Object.freeze(skippedRows),
    sourceIdentities: Object.freeze([...sourceIdentities].sort()),
    duplicateContentRows,
    duplicateDailyRows,
    duplicateResolution: 'later_sequence_wins',
  });
}

function requireNormalizedResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Organic normalizer must return an object');
  }
  if (!value.content || !value.dailySnapshot) {
    throw new TypeError('Organic normalizer must return content and dailySnapshot');
  }
  if (typeof value.content.content_key !== 'string' || value.content.content_key.trim() === '') {
    throw new TypeError('Organic normalized content requires content_key');
  }
  if (typeof value.dailySnapshot.content_daily_key !== 'string'
    || value.dailySnapshot.content_daily_key.trim() === '') {
    throw new TypeError('Organic normalized daily snapshot requires content_daily_key');
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`${fieldName} must be a function`);
  return value;
}

function normalizeOptionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  return text || null;
}

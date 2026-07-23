/**
 * สร้าง Destination plans ของ Organic content แบบ Platform-neutral
 * Adapter/Use case ภายนอกยังต้องตรวจ Source identity และ Account conflict ก่อน Write
 */
export async function planOrganicContentDestination(input = {}) {
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const contentRows = requireArray(input.contentRows, 'contentRows');
  const dailySnapshotRows = requireArray(input.dailySnapshotRows, 'dailySnapshotRows');
  const tables = requireTables(input.tables);
  const progress = typeof input.onProgress === 'function' ? input.onProgress : () => undefined;

  const [content, dailySnapshots] = await Promise.all([
    syncEngine.planByKey({
      repository,
      tableId: tables.mktContent,
      keyField: 'content_key',
      rows: contentRows,
      onProgress: (event) => progress({ scope: 'content', ...event }),
    }),
    syncEngine.planByKey({
      repository,
      tableId: tables.mktContentDaily,
      keyField: 'content_daily_key',
      rows: dailySnapshotRows,
      onProgress: (event) => progress({ scope: 'daily_snapshots', ...event }),
    }),
  ]);

  return Object.freeze({
    plans: Object.freeze({ content, dailySnapshots }),
    reconciliation: analyzeOrganicDestinationConsistency(content, dailySnapshots),
  });
}

/** ตรวจ Master/Daily ที่หายคนละฝั่งจาก Preflight plan */
export function analyzeOrganicDestinationConsistency(contentPlan, dailyPlan) {
  const contentCreateIds = new Set(contentPlan.createRows.map(readExternalContentId));
  const dailyCreateIds = new Set(dailyPlan.createRows.map(readExternalContentId));
  const allIds = new Set([...contentCreateIds, ...dailyCreateIds]);
  const missingContentIds = [];
  const missingDailySnapshotIds = [];

  for (const externalContentId of allIds) {
    const contentMissing = contentCreateIds.has(externalContentId);
    const dailyMissing = dailyCreateIds.has(externalContentId);
    if (contentMissing && !dailyMissing) missingContentIds.push(externalContentId);
    if (!contentMissing && dailyMissing) missingDailySnapshotIds.push(externalContentId);
  }

  const required = missingContentIds.length > 0 || missingDailySnapshotIds.length > 0;
  return Object.freeze({
    required,
    status: required ? 'recovery_required' : 'consistent',
    missingContentRows: missingContentIds.length,
    missingDailySnapshotRows: missingDailySnapshotIds.length,
    missingContentIds: Object.freeze(missingContentIds.slice(0, 20)),
    missingDailySnapshotIds: Object.freeze(missingDailySnapshotIds.slice(0, 20)),
  });
}

function readExternalContentId(row) {
  const value = row?.external_content_id;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('Organic destination row requires external_content_id');
  }
  return value.trim();
}

function requireRepository(value) {
  for (const method of ['prepareRows', 'createMany', 'updateMany']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Organic destination planning requires repository.${method}`);
    }
  }
  return value;
}

function requireSyncEngine(value) {
  if (typeof value?.planByKey !== 'function') {
    throw new TypeError('Organic destination planning requires syncEngine.planByKey');
  }
  return value;
}

function requireTables(value) {
  return Object.freeze({
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
  });
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

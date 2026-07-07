export function createDailySnapshotKey({ platform, accountId, entityId, metricDate }) {
  const parts = [platform, accountId, entityId, metricDate];
  if (parts.some((part) => part === null || part === undefined || part === '')) {
    throw new Error('Snapshot key requires platform, accountId, entityId, and metricDate');
  }

  return parts.join('::');
}

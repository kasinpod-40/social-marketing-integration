export function createContentKey({ platform, accountId, externalContentId }) {
  return joinRequiredParts('Content key', [platform, accountId, externalContentId]);
}

export function createDailySnapshotKey({ platform, accountId, entityId, metricDate }) {
  return joinRequiredParts('Snapshot key', [platform, accountId, entityId, metricDate]);
}

function joinRequiredParts(label, parts) {
  if (parts.some((part) => part === null || part === undefined || part === '')) {
    throw new Error(`${label} requires all identity fields`);
  }

  return parts.join('::');
}

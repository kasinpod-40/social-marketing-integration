const IDENTITY_KEY_SEPARATOR = ':';

export function createContentKey({ platform, accountId, externalContentId }) {
  return joinRequiredParts('Content key', [platform, accountId, externalContentId]);
}

export function createDailySnapshotKey({ platform, accountId, entityId, metricDate }) {
  return joinRequiredParts('Snapshot key', [platform, accountId, entityId, metricDate]);
}

function joinRequiredParts(label, parts) {
  return parts
    .map((part) => normalizeIdentityPart(label, part))
    .join(IDENTITY_KEY_SEPARATOR);
}

function normalizeIdentityPart(label, part) {
  if (typeof part !== 'string' || part.trim() === '') {
    throw new Error(`${label} requires all identity fields`);
  }

  return part.trim();
}

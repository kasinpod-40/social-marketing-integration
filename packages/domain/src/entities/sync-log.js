const ALLOWED_SYNC_STATUSES = new Set(['queued', 'running', 'success', 'partial_success', 'failed']);

export function createSyncLogEntry(input) {
  const status = input.status ?? 'queued';
  if (!ALLOWED_SYNC_STATUSES.has(status)) {
    throw new Error(`Invalid sync status: ${status}`);
  }

  return {
    syncId: input.syncId ?? crypto.randomUUID(),
    platform: input.platform,
    syncType: input.syncType,
    status,
    startedAt: input.startedAt ?? null,
    finishedAt: input.finishedAt ?? null,
    recordsPulled: input.recordsPulled ?? 0,
    recordsWritten: input.recordsWritten ?? 0,
    retryCount: input.retryCount ?? 0,
    errorMessage: input.errorMessage ?? null,
  };
}

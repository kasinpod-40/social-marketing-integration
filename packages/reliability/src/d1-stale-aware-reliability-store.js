import { D1ReliabilityStore } from './d1-reliability-store.js';
import { sanitizeOperationalText, transientError } from '../../shared/src/errors/runtime-error.js';

/**
 * Extends the existing D1 Reliability store without creating a parallel lock stack.
 * A failed acquire additionally returns the persisted expiry so Queue retry can wait past the stale lease.
 */
export class D1StaleAwareReliabilityStore extends D1ReliabilityStore {
  async acquire(input) {
    const result = await super.acquire(input);
    if (result.acquired) return result;
    try {
      const row = await this.db.prepare(`
        SELECT expires_at
        FROM sync_locks
        WHERE lock_key = ?
      `).bind(input.lockKey).first();
      const expiresAt = Number(row?.expires_at);
      return Object.freeze({
        ...result,
        expiresAt: Number.isSafeInteger(expiresAt) && expiresAt >= 0 ? expiresAt : null,
      });
    } catch (cause) {
      throw transientError('Failed to read busy distributed sync lock lease', {
        code: 'D1_SYNC_LOCK_READ_FAILED',
        cause,
        details: {
          lockKey: input?.lockKey ?? null,
          causeMessage: sanitizeOperationalText(cause instanceof Error ? cause.message : String(cause)),
        },
      });
    }
  }
}

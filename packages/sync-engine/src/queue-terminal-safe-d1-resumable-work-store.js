import { D1ResumableWorkStore as BaseD1ResumableWorkStore } from './d1-resumable-work-store.js';

/**
 * Queue failure handling must never reverse durable completion.
 * The base store still supports terminal/superseded lifecycle transitions for active Work, while
 * this Queue-specific adapter treats a completed Work as immutable operational evidence.
 */
export class D1ResumableWorkStore extends BaseD1ResumableWorkStore {
  async abandonWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const current = await this.db.prepare(`
      SELECT lifecycle_status
      FROM sync_work_runs
      WHERE work_key = ?
    `).bind(workKey).first();
    if (current?.lifecycle_status === 'completed') {
      return Object.freeze({
        terminal: false,
        found: true,
        status: 'completed',
        protectedCompletedWork: true,
      });
    }
    return super.abandonWork(input);
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Queue-terminal-safe Work store requires ${fieldName}`);
  }
  return value.trim();
}

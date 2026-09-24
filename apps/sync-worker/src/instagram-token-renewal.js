import { refreshInstagramToken } from '../../../packages/connectors/src/meta/instagram-token-renewal.js';
import { PRIMARY_SCHEDULE_CRON } from './scheduled-jobs.js';
import {
  decryptInstagramCredential, loadInstagramCredential,
  recordInstagramRefreshFailure, rotateInstagramCredential,
} from './instagram-access-token.js';

const LEAD_MS = 5 * 24 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

/** Existing five-minute Cron runs this once at 06:00 ICT; failures cannot block normal sync. */
export async function maybeRefreshInstagramToken(event, env, options = {}) {
  if (env?.MKT_INSTAGRAM_D1_TOKEN_ENABLED !== 'true' || event?.cron !== PRIMARY_SCHEDULE_CRON) return;
  const now = event?.scheduledTime;
  if (!Number.isSafeInteger(now) || now % DAY_MS !== 23 * 60 * 60 * 1_000) return;
  let row;
  let db;
  try {
    ({ row, db } = await loadInstagramCredential(env, now));
    if (now < row.token_expires_at - LEAD_MS) return;
    const token = await decryptInstagramCredential(row, env);
    const result = await (options.refresh ?? refreshInstagramToken)({
      currentToken: token,
      expectedAccountId: env.META_INSTAGRAM_ACCOUNT_ID,
      fetchImpl: options.fetchImpl,
      now: () => now,
    });
    if (!Number.isSafeInteger(result.expiresAt) || result.expiresAt <= now + LEAD_MS) {
      throw safeError('META_IG_REFRESH_RESPONSE_INVALID');
    }
    await rotateInstagramCredential(db, row, env, result.token, result.expiresAt, now);
    console.info(JSON.stringify({ scope: 'instagram_token_renewal', status: 'rotated',
      expiresAt: new Date(result.expiresAt).toISOString() }));
  } catch (error) {
    const code = typeof error?.code === 'string' && /^META_IG_[A-Z_]+$/u.test(error.code)
      ? error.code : 'META_IG_RENEWAL_FAILED';
    if (row && db) {
      try { await recordInstagramRefreshFailure(db, row, code, now); } catch { /* log remains */ }
    }
    console.error(JSON.stringify({ scope: 'instagram_token_renewal', status: 'failed', code }));
  }
}

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

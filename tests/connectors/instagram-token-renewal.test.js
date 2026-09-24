import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { refreshInstagramToken } from '../../packages/connectors/src/meta/instagram-token-renewal.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';
import {
  loadInstagramCredential, resolveInstagramAccessToken, rotateInstagramCredential,
} from '../../apps/sync-worker/src/instagram-access-token.js';
import { maybeRefreshInstagramToken } from '../../apps/sync-worker/src/instagram-token-renewal.js';
import { PRIMARY_SCHEDULE_CRON } from '../../apps/sync-worker/src/scheduled-jobs.js';

const secret = 'old-secret';
const expectedAccountId = '123456';
const now = Date.parse('2026-09-24T23:00:00Z');
const key = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const migration = readFileSync(new URL('../../migrations/0022_instagram_token_renewal_status.sql', import.meta.url), 'utf8');

function setup() {
  const db = createSqliteD1();
  db.exec(migration);
  return { db, env: {
    MKT_INSTAGRAM_D1_TOKEN_ENABLED: 'true',
    MKT_STATE_DB: db,
    META_INSTAGRAM_ACCESS_TOKEN: secret,
    META_INSTAGRAM_ACCOUNT_ID: expectedAccountId,
    MKT_INSTAGRAM_INITIAL_EXPIRES_AT: '2026-11-23T04:50:22Z',
    MKT_CONNECTION_ENCRYPTION_KEY_VERSION: 'v2',
    MKT_CONNECTION_ENCRYPTION_KEY_V2: key,
  } };
}

function event(scheduledTime = now) {
  return { cron: PRIMARY_SCHEDULE_CRON, scheduledTime };
}

test('Meta refresh validates identity and never sends plaintext to D1 itself', async () => {
  const requests = [];
  const result = await refreshInstagramToken({ currentToken: secret, expectedAccountId,
    now: () => now, fetchImpl: async (url, init) => {
      requests.push({ url: new URL(url), init });
      return Response.json(requests.length === 1
        ? { access_token: 'new-secret', expires_in: 5_184_000 }
        : { user_id: expectedAccountId });
    } });
  assert.deepEqual(result, { token: 'new-secret', expiresAt: now + 5_184_000_000 });
  assert.equal(requests.length, 2);
  assert.equal(requests[0].url.searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(requests[1].init.headers.authorization, 'Bearer new-secret');
});

test('identity mismatch or short grant rejects refresh', async () => {
  let calls = 0;
  await assert.rejects(() => refreshInstagramToken({ currentToken: secret, expectedAccountId,
    fetchImpl: async () => {
      calls += 1;
      return Response.json(calls === 1
        ? { access_token: 'new-secret', expires_in: 5_184_000 }
        : { user_id: 'wrong' });
    } }), { code: 'META_IG_REFRESH_IDENTITY_MISMATCH' });
  await assert.rejects(() => refreshInstagramToken({ currentToken: secret, expectedAccountId,
    fetchImpl: async () => Response.json({ access_token: 'new-secret', expires_in: 1000 }) }),
  { code: 'META_IG_REFRESH_RESPONSE_INVALID' });
});

test('D1 bootstrap contains ciphertext, resolver reads it, and disabled mode keeps Worker Secret', async () => {
  const { db, env } = setup();
  try {
    assert.equal(await resolveInstagramAccessToken({ META_INSTAGRAM_ACCESS_TOKEN: secret }), secret);
    assert.equal(await resolveInstagramAccessToken(env), secret);
    const row = await db.prepare('SELECT * FROM instagram_token_credentials').first();
    assert.equal(row.algorithm, 'AES-256-GCM');
    assert.equal(row.key_version, 'v2');
    assert.equal(row.ciphertext.includes(secret), false);
    assert.equal(row.token_expires_at, Date.parse(env.MKT_INSTAGRAM_INITIAL_EXPIRES_AT));
    assert.equal(row.data_access_expires_at, Date.parse('2026-12-23T04:50:20Z'));
    env.META_INSTAGRAM_ACCESS_TOKEN = 'stale-worker-secret';
    assert.equal(await resolveInstagramAccessToken(env), secret);
    env.MKT_CONNECTION_ENCRYPTION_KEY_V2 = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');
    await assert.rejects(() => resolveInstagramAccessToken(env));
  } finally { db.close(); }
});

test('day-55 check rotates encrypted D1 row and uses current token on next job', async () => {
  const { db, env } = setup();
  const refreshTime = Date.parse('2026-11-18T23:00:00Z');
  let calls = 0;
  const lines = [];
  const originalInfo = console.info;
  console.info = (line) => lines.push(line);
  try {
    await maybeRefreshInstagramToken(event(now), env, { refresh: async () => { calls += 1; } });
    assert.equal(calls, 0);
    await maybeRefreshInstagramToken(event(refreshTime + 60_000), env, { refresh: async () => { calls += 1; } });
    assert.equal(calls, 0);
    await maybeRefreshInstagramToken(event(refreshTime), env, { refresh: async ({ currentToken }) => {
      assert.equal(currentToken, secret);
      calls += 1;
      return { token: 'new-secret', expiresAt: refreshTime + 60 * 24 * 60 * 60 * 1000 };
    } });
    assert.equal(calls, 1);
    assert.equal(await resolveInstagramAccessToken(env), 'new-secret');
    const row = await db.prepare('SELECT * FROM instagram_token_credentials').first();
    assert.equal(row.status, 'active');
    assert.equal(row.last_refresh_at, refreshTime);
    assert.equal(row.ciphertext.includes('new-secret'), false);
    assert.equal(lines.join('').includes('new-secret'), false);
  } finally { console.info = originalInfo; db.close(); }
});

test('failed provider refresh preserves token and records sanitized code for next-day retry', async () => {
  const { db, env } = setup();
  const refreshTime = Date.parse('2026-11-18T23:00:00Z');
  const lines = [];
  const originalError = console.error;
  console.error = (line) => lines.push(line);
  try {
    await maybeRefreshInstagramToken(event(refreshTime), env, { refresh: async () => {
      throw new Error(`provider body ${secret}`);
    } });
    assert.equal(await resolveInstagramAccessToken(env), secret);
    const row = await db.prepare('SELECT * FROM instagram_token_credentials').first();
    assert.equal(row.status, 'refresh_failed');
    assert.equal(row.last_error_code, 'META_IG_RENEWAL_FAILED');
    assert.equal(lines.join('').includes(secret), false);
    await maybeRefreshInstagramToken(event(refreshTime + 24 * 60 * 60 * 1000), env,
      { refresh: async () => ({ token: 'retry-secret', expiresAt: refreshTime + 60 * 24 * 60 * 60 * 1000 }) });
    assert.equal(await resolveInstagramAccessToken(env), 'retry-secret');
  } finally { console.error = originalError; db.close(); }
});

test('compare-and-swap cannot overwrite newer credential', async () => {
  const { db, env } = setup();
  try {
    const { row } = await loadInstagramCredential(env, now);
    await rotateInstagramCredential(db, row, env, 'first-secret', now + 60 * 24 * 60 * 60 * 1000, now);
    await assert.rejects(() => rotateInstagramCredential(db, row, env, 'stale-secret',
      now + 60 * 24 * 60 * 60 * 1000, now), { code: 'META_IG_ROTATION_CONFLICT' });
    assert.equal(await resolveInstagramAccessToken(env), 'first-secret');
  } finally { db.close(); }
});

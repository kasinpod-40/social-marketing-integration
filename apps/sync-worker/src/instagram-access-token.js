import { decryptSecret, encryptSecret } from '../../../packages/shared/src/security/secure-token.js';

const PROFILE = 'chemistry_k';
const CONTEXT = Object.freeze({ connectionId: 'instagram:chemistry_k', connectorKey: 'instagram',
  credentialKind: 'access_token' });
const INITIAL_DATA_ACCESS_EXPIRY = Date.parse('2026-12-23T04:50:20Z');

/** Read encrypted D1 credential when enabled; bootstrap it once from the existing Worker Secret. */
export async function resolveInstagramAccessToken(env = {}) {
  if (env.MKT_INSTAGRAM_D1_TOKEN_ENABLED !== 'true') return env.META_INSTAGRAM_ACCESS_TOKEN;
  const { row } = await loadInstagramCredential(env);
  return decryptRow(row, env);
}

export async function loadInstagramCredential(env = {}, now = Date.now()) {
  const db = env.MKT_STATE_DB;
  if (typeof db?.prepare !== 'function') throw safeError('META_IG_CREDENTIAL_STORE_MISSING');
  let row = await readRow(db);
  if (!row) {
    const token = env.META_INSTAGRAM_ACCESS_TOKEN;
    const expiry = Date.parse(env.MKT_INSTAGRAM_INITIAL_EXPIRES_AT);
    if (typeof token !== 'string' || !token.trim() || !Number.isSafeInteger(expiry) || expiry <= now) {
      throw safeError('META_IG_BOOTSTRAP_INVALID');
    }
    const encrypted = await encryptToken(token.trim(), env);
    await db.prepare(`INSERT OR IGNORE INTO instagram_token_credentials
      (customer_profile, algorithm, key_version, iv, ciphertext, token_expires_at,
       data_access_expires_at, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
      .bind(PROFILE, encrypted.algorithm, encrypted.keyVersion, encrypted.iv,
        encrypted.ciphertext, expiry, INITIAL_DATA_ACCESS_EXPIRY, now).run();
    row = await readRow(db);
    if (!row) throw safeError('META_IG_BOOTSTRAP_FAILED');
  }
  return { row, db };
}

export async function decryptInstagramCredential(row, env) {
  return decryptRow(row, env);
}

export async function rotateInstagramCredential(db, row, env, token, expiresAt, now) {
  const encrypted = await encryptToken(token, env);
  const result = await db.prepare(`UPDATE instagram_token_credentials SET
    algorithm = ?, key_version = ?, iv = ?, ciphertext = ?, token_expires_at = ?,
    last_refresh_at = ?, last_attempt_at = ?, status = 'active', last_error_code = NULL, updated_at = ?
    WHERE customer_profile = ? AND iv = ? AND ciphertext = ?`)
    .bind(encrypted.algorithm, encrypted.keyVersion, encrypted.iv, encrypted.ciphertext,
      expiresAt, now, now, now, PROFILE, row.iv, row.ciphertext).run();
  if (result?.meta?.changes !== 1) throw safeError('META_IG_ROTATION_CONFLICT');
}

export async function recordInstagramRefreshFailure(db, row, code, now) {
  await db.prepare(`UPDATE instagram_token_credentials SET
    last_attempt_at = ?, status = 'refresh_failed', last_error_code = ?, updated_at = ?
    WHERE customer_profile = ? AND iv = ? AND ciphertext = ?`)
    .bind(now, code, now, PROFILE, row.iv, row.ciphertext).run();
}

async function readRow(db) {
  return db.prepare(`SELECT algorithm, key_version, iv, ciphertext, token_expires_at,
    data_access_expires_at, last_refresh_at, last_attempt_at, status, last_error_code
    FROM instagram_token_credentials WHERE customer_profile = ?`).bind(PROFILE).first();
}

async function encryptToken(token, env) {
  const version = requireVersion(env.MKT_CONNECTION_ENCRYPTION_KEY_VERSION);
  return encryptSecret(token, requireKey(env, version), { keyVersion: version,
    authenticatedContext: CONTEXT });
}

async function decryptRow(row, env) {
  const version = requireVersion(row.key_version);
  return decryptSecret({ algorithm: row.algorithm, keyVersion: version,
    iv: row.iv, ciphertext: row.ciphertext }, requireKey(env, version), {
    keyVersion: version, authenticatedContext: CONTEXT,
  });
}

function requireVersion(value) {
  if (typeof value !== 'string' || !/^v[1-9][0-9]*$/u.test(value)) {
    throw safeError('META_IG_ENCRYPTION_KEY_VERSION_INVALID');
  }
  return value;
}

function requireKey(env, version) {
  const key = env[`MKT_CONNECTION_ENCRYPTION_KEY_${version.toUpperCase()}`];
  if (typeof key !== 'string' || !key) throw safeError('META_IG_ENCRYPTION_KEY_MISSING');
  return key;
}

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

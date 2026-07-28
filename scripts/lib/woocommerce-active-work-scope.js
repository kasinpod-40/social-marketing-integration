const ACTIVE_ALIAS = /\bAS\s+(?:active_work|active_work_count)\b/iu;
const WORK_SCOPE = "work_key LIKE 'woocommerce:%'";
const LOCK_SCOPE = "owner_id LIKE 'woocommerce:%'";

/**
 * Scope only the two guarded WooCommerce rollout active-work queries.
 * Shared Integration Workspace work from TikTok/Meta/YouTube/Chatwoot must not block
 * WooCommerce, while any active WooCommerce work or lock remains fail-closed.
 */
export function scopeWooCommerceActiveWorkSql(value) {
  const sql = requireSql(value);
  if (!ACTIVE_ALIAS.test(sql) || !/\bsync_work_runs\b/iu.test(sql) || !/\bsync_locks\b/iu.test(sql)) {
    return Object.freeze({ changed: false, sql });
  }

  let scoped = sql;
  scoped = scoped.replace(
    /(FROM\s+sync_work_runs\s+WHERE\s+lifecycle_status\s*=\s*'active')(?!\s+AND\s+work_key\s+LIKE\s+'woocommerce:%')/giu,
    `$1 AND ${WORK_SCOPE}`,
  );
  scoped = scoped.replace(
    /(FROM\s+sync_locks\s+WHERE\s+expires_at\s*>\s*unixepoch\('now'\)\s*\*\s*1000)(?!\s+AND\s+owner_id\s+LIKE\s+'woocommerce:%')/giu,
    `$1 AND ${LOCK_SCOPE}`,
  );

  const changed = scoped !== sql;
  if (changed && (!scoped.includes(WORK_SCOPE) || !scoped.includes(LOCK_SCOPE))) {
    throw scopeError('WooCommerce active-work SQL was only partially scoped');
  }
  return Object.freeze({ changed, sql: scoped });
}

export function rewriteWooCommerceD1CommandArgs(argsInput) {
  const args = Array.isArray(argsInput) ? [...argsInput] : [];
  const commandIndex = args.indexOf('--command');
  const isRemoteD1 = args.includes('wrangler')
    && args.includes('d1')
    && args.includes('execute')
    && args.includes('--remote');
  if (!isRemoteD1 || commandIndex < 0 || typeof args[commandIndex + 1] !== 'string') {
    return Object.freeze({ changed: false, args: Object.freeze(args) });
  }
  const result = scopeWooCommerceActiveWorkSql(args[commandIndex + 1]);
  if (!result.changed) return Object.freeze({ changed: false, args: Object.freeze(args) });
  args[commandIndex + 1] = result.sql;
  return Object.freeze({ changed: true, args: Object.freeze(args) });
}

function requireSql(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw scopeError('WooCommerce active-work SQL is required');
  }
  return value;
}

function scopeError(message) {
  const error = new Error(message);
  error.name = 'WooCommerceActiveWorkScopeError';
  error.code = 'WOOCOMMERCE_ACTIVE_WORK_SCOPE_INVALID';
  return error;
}

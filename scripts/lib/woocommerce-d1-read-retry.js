const READ_PREFIX = /^(?:SELECT|WITH)\b/iu;
const MUTATION = /\b(?:ALTER|ATTACH|CREATE|DELETE|DETACH|DROP|INSERT|PRAGMA|REPLACE|UPDATE|VACUUM)\b/iu;

export const WOOCOMMERCE_D1_READ_RETRY_DELAYS_MS = Object.freeze([
  1_000,
  2_000,
  5_000,
  10_000,
]);

/**
 * จำกัด Retry เฉพาะ Wrangler Remote D1 execute ที่เป็น Read-only SQL เท่านั้น
 * เพื่อไม่ให้ Wrapper นี้เปลี่ยน semantics ของ Deploy, Queue, Migration หรือ D1 mutation.
 */
export function classifyWooCommerceD1ReadCommand(argsInput) {
  const args = Array.isArray(argsInput) ? [...argsInput] : [];
  const commandIndex = args.indexOf('--command');
  const sql = commandIndex >= 0 && typeof args[commandIndex + 1] === 'string'
    ? args[commandIndex + 1].trim()
    : '';
  const eligible = args[0] === 'wrangler'
    && args.includes('d1')
    && args.includes('execute')
    && args.includes('--remote')
    && commandIndex >= 0
    && READ_PREFIX.test(sql)
    && !MUTATION.test(sql);
  return Object.freeze({
    eligible,
    args: Object.freeze(args),
    sqlKind: eligible ? READ_PREFIX.exec(sql)?.[0]?.toUpperCase() ?? null : null,
  });
}

export function wooCommerceD1ReadRetryDelay(attempt) {
  const index = Number(attempt) - 1;
  if (!Number.isSafeInteger(index) || index < 0) return null;
  return WOOCOMMERCE_D1_READ_RETRY_DELAYS_MS[index] ?? null;
}

export function wooCommerceD1ReadMaxAttempts() {
  return WOOCOMMERCE_D1_READ_RETRY_DELAYS_MS.length + 1;
}

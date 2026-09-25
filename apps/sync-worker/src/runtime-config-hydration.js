import { D1RuntimeConfigStore } from '../../../packages/connectors/src/d1-runtime-config-store.js';

export async function hydrateRuntimeEnvFromD1(env = {}, dependencies = {}) {
  if (!canHydrate(env)) return env;
  const store = dependencies.store ?? new D1RuntimeConfigStore({ db: env.MKT_STATE_DB });
  const rows = await store.list({
    environment: env.MKT_ENV,
    customerKey: env.MKT_CONNECTION_CUSTOMER_KEY,
  });
  if (rows.length === 0) return env;

  const overlay = {};
  for (const row of rows) {
    if (Object.hasOwn(overlay, row.configKey)) {
      throw new TypeError(`Duplicate D1 runtime config key: ${row.configKey}`);
    }
    overlay[row.configKey] = row.configValue;
  }
  return Object.freeze({ ...env, ...overlay });
}

function canHydrate(env) {
  return (
    typeof env?.MKT_STATE_DB?.prepare === 'function'
    && typeof env?.MKT_ENV === 'string'
    && env.MKT_ENV.trim() !== ''
    && typeof env?.MKT_CONNECTION_CUSTOMER_KEY === 'string'
    && env.MKT_CONNECTION_CUSTOMER_KEY.trim() !== ''
  );
}

import { requireD1RuntimeConfigKey } from '../../config/src/d1-runtime-config-contract.js';
import { transientError } from '../../shared/src/errors/runtime-error.js';

export class D1RuntimeConfigStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async list(input = {}) {
    const environment = requireEnvironment(input.environment);
    const customerKey = requireText(input.customerKey, 'customerKey');
    let result;
    try {
      result = await this.db.prepare(`
        SELECT config_key, config_value, source, updated_at
        FROM runtime_config
        WHERE environment = ? AND customer_key = ?
        ORDER BY config_key ASC
      `).bind(environment, customerKey).all();
    } catch (cause) {
      throw transientError('D1 runtime config read failed', {
        code: 'RUNTIME_CONFIG_D1_READ_FAILED',
        cause,
      });
    }
    const rows = Array.isArray(result?.results) ? result.results : [];
    return Object.freeze(rows.map((row) => Object.freeze({
      configKey: requireD1RuntimeConfigKey(row.config_key),
      configValue: String(row.config_value ?? ''),
      source: String(row.source ?? 'customer_d1'),
      updatedAt: Number(row.updated_at),
    })));
  }
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1 runtime config store requires db');
  return value;
}

function requireEnvironment(value) {
  const environment = requireText(value, 'environment');
  if (!['development', 'production'].includes(environment)) {
    throw new TypeError('environment must be development or production');
  }
  return environment;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

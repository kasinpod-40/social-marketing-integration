import { D1MarketingHistoryStore } from './d1-marketing-history-store.js';
import { permanentError, transientError } from '../shared/src/errors/runtime-error.js';

const REQUIRED_TABLES = Object.freeze([
  'organic_content_state',
  'organic_content_observations',
  'data_coverage_runs',
  'data_coverage_entities',
]);
const STATE_READ_BATCH_SIZE = 100;
const MAX_STATE_READ_KEYS = 1_000;

/**
 * Runtime gateway สำหรับ Organic Marketing history
 *
 * ใช้ Store Foundation เดิมเป็น Writer และเพิ่มเฉพาะ Schema guard/Read methods
 * ที่ Phase bootstrap ต้องใช้ โดยไม่สร้าง Reliability stack หรือ D1 binding ใหม่.
 */
export class D1OrganicHistoryGateway {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.store = input.store ?? new D1MarketingHistoryStore({ db: this.db });
  }

  async assertSchemaReady() {
    let rows;
    try {
      const result = await this.db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name IN (${placeholders(REQUIRED_TABLES.length)})
        ORDER BY name ASC
      `).bind(...REQUIRED_TABLES).all();
      rows = Array.isArray(result) ? result : (result?.results ?? []);
    } catch (cause) {
      throw transientError('Failed to inspect Marketing history schema', {
        code: 'D1_MARKETING_STORAGE_SCHEMA_CHECK_FAILED',
        cause,
      });
    }

    const existing = new Set(rows.map((row) => String(row?.name ?? '')));
    const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
    if (missing.length > 0) {
      throw permanentError('Marketing history storage schema is not ready', {
        code: 'D1_MARKETING_STORAGE_SCHEMA_NOT_READY',
        details: { missingTables: missing },
      });
    }
    return Object.freeze({ ready: true, tables: REQUIRED_TABLES });
  }

  async listOrganicContentStatesByKeys(contentKeys) {
    const keys = normalizeKeys(contentKeys);
    if (keys.length === 0) return Object.freeze([]);
    const rows = [];

    for (let offset = 0; offset < keys.length; offset += STATE_READ_BATCH_SIZE) {
      const batch = keys.slice(offset, offset + STATE_READ_BATCH_SIZE);
      let result;
      try {
        result = await this.db.prepare(`
          SELECT * FROM organic_content_state
          WHERE content_key IN (${placeholders(batch.length)})
          ORDER BY content_key ASC
        `).bind(...batch).all();
      } catch (cause) {
        throw transientError('Failed to read Organic current state', {
          code: 'D1_ORGANIC_CONTENT_STATE_READ_FAILED',
          cause,
        });
      }
      const batchRows = Array.isArray(result) ? result : (result?.results ?? []);
      rows.push(...batchRows.map((row) => Object.freeze({ ...row })));
    }
    return Object.freeze(rows);
  }

  async readCoverageRun(coverageRunId) {
    const id = requireText(coverageRunId, 'coverageRunId');
    try {
      const row = await this.db.prepare(
        'SELECT * FROM data_coverage_runs WHERE coverage_run_id = ?',
      ).bind(id).first();
      return row ? Object.freeze({ ...row }) : null;
    } catch (cause) {
      throw transientError('Failed to read Organic coverage run', {
        code: 'D1_ORGANIC_COVERAGE_READ_FAILED',
        cause,
      });
    }
  }

  upsertOrganicContentState(value) {
    return this.store.upsertOrganicContentState(value);
  }

  saveOrganicContentObservation(value) {
    return this.store.saveOrganicContentObservation(value);
  }

  saveCoverageRun(value) {
    return this.store.saveCoverageRun(value);
  }

  saveCoverageEntities(values) {
    return this.store.saveCoverageEntities(values);
  }
}

function normalizeKeys(values) {
  if (!Array.isArray(values)) {
    throw permanentError('Organic current-state keys must be an array', {
      code: 'MKT_ORGANIC_HISTORY_INPUT_INVALID',
    });
  }
  const keys = [...new Set(values.map((value) => requireText(value, 'contentKey')))];
  if (keys.length > MAX_STATE_READ_KEYS) {
    throw permanentError(`Organic current-state read exceeds ${MAX_STATE_READ_KEYS} keys`, {
      code: 'MKT_ORGANIC_HISTORY_INPUT_INVALID',
      details: { keyCount: keys.length },
    });
  }
  return keys.sort();
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1OrganicHistoryGateway requires a D1 binding');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`${fieldName} is required`, {
      code: 'MKT_ORGANIC_HISTORY_INPUT_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

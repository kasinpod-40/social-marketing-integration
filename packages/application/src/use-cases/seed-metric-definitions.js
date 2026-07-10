import { METRIC_DEFINITION_ROWS } from '../../../config/src/metric-definitions.seed.js';

/** Seeds MKT_Metric_Definitions through the universal table sync engine. */
export async function seedMetricDefinitions(input) {
  const repository = requireRepository(input?.repository);
  const syncEngine = requireSyncEngine(input?.syncEngine);
  const tableId = requireText(input?.tableId, 'tableId');
  const rows = input?.rows ?? METRIC_DEFINITION_ROWS;

  return syncEngine.syncByKey({ repository, tableId, keyField: 'metric_key', rows });
}

function requireRepository(repository) {
  for (const method of ['listAll', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') throw new TypeError(`seedMetricDefinitions requires repository.${method}`);
  }
  return repository;
}

function requireSyncEngine(syncEngine) {
  if (typeof syncEngine?.syncByKey !== 'function') throw new TypeError('seedMetricDefinitions requires syncEngine.syncByKey');
  return syncEngine;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`seedMetricDefinitions requires ${fieldName}`);
  return value.trim();
}

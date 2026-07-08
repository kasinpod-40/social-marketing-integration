import { METRIC_DEFINITION_ROWS } from '../../../config/src/metric-definitions.seed.js';

/**
 * Seeds MKT_Metric_Definitions with stable metric keys. Idempotent through
 * repository.upsertByKey and safe to rerun after field/table corrections.
 *
 * @param {{repository: {upsertByKey: Function}, tableId: string, rows?: Object[]}} input
 */
export async function seedMetricDefinitions(input) {
  const repository = requireRepository(input?.repository);
  const tableId = requireText(input?.tableId, 'tableId');
  const rows = input?.rows ?? METRIC_DEFINITION_ROWS;

  return repository.upsertByKey({
    tableId,
    keyField: 'metric_key',
    rows,
  });
}

function requireRepository(repository) {
  if (typeof repository?.upsertByKey !== 'function') {
    throw new TypeError('seedMetricDefinitions requires repository.upsertByKey');
  }

  return repository;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`seedMetricDefinitions requires ${fieldName}`);
  }

  return value.trim();
}

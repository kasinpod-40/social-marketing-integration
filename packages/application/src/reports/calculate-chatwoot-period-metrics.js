import { CHATWOOT_REPORT_CONTRACT } from '../../../config/src/chatwoot-report-contract.js';

const EVENT_FIELDS = Object.freeze([
  'new_conversation_count',
  'resolved_count',
  'reopened_count',
  'incoming_message_count',
  'outgoing_message_count',
  'private_message_count',
  'attachment_message_count',
]);
const DURATION_FIELDS = Object.freeze([
  'first_response_seconds',
  'resolution_seconds',
  'reply_seconds',
]);
const SNAPSHOT_FIELDS = Object.freeze([
  'conversation_count',
  'open_conversation_count',
  'pending_conversation_count',
  'snoozed_conversation_count',
  'active_agent_count',
  'active_inbox_count',
]);

/** Calculate one completed Chatwoot period without averaging daily averages. */
export function calculateChatwootPeriodMetrics(input = {}) {
  const facts = requireRows(input.facts, 'facts');
  const snapshot = input.periodEndSnapshot ?? null;
  const coverageComplete = input.coverage?.complete === true;
  const values = Object.fromEntries(CHATWOOT_REPORT_CONTRACT.summaryMetrics.map((metric) => [
    metric.metricKey,
    null,
  ]));

  if (coverageComplete) {
    for (const field of EVENT_FIELDS) {
      values[summaryKeyForSourceField(field, 'sum')] = sumField(facts, field);
    }
    for (const field of DURATION_FIELDS) {
      const eligible = facts.map((row) => finiteOrNull(row[field])).filter((value) => value !== null);
      values[summaryKeyForSourceField(field, 'count_non_null')] = eligible.length;
      values[summaryKeyForSourceField(field, 'sum_non_null_divide_count_non_null')] = eligible.length === 0
        ? null
        : eligible.reduce((sum, value) => sum + value, 0) / eligible.length;
    }
    for (const field of SNAPSHOT_FIELDS) {
      values[summaryKeyForSourceField(field, 'latest_completed_day_value')] = snapshot
        ? finiteOrNull(snapshot[field])
        : null;
    }
  }

  return Object.freeze({
    dataStatus: coverageComplete ? 'complete' : 'source_unavailable',
    coverageRate: coverageComplete ? 1 : null,
    metrics: Object.freeze(values),
    factRows: facts.length,
    snapshotRows: snapshot ? 1 : 0,
  });
}

export function buildChatwootMetricPayload(input = {}) {
  const platform = requireText(input.platform ?? 'chatwoot', 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const current = requireObject(input.current, 'current');
  const compare = input.compare ? requireObject(input.compare, 'compare') : null;

  return Object.freeze(Object.fromEntries(CHATWOOT_REPORT_CONTRACT.summaryMetrics.map((definition, index) => {
    const currentValue = finiteOrNull(current.metrics?.[definition.metricKey]);
    const compareValue = compare ? finiteOrNull(compare.metrics?.[definition.metricKey]) : null;
    const change = currentValue === null || compareValue === null ? null : currentValue - compareValue;
    const metricKey = definition.metricKey.startsWith(`${platform}:`)
      ? definition.metricKey
      : `${platform}:${definition.metricKey.split(':').slice(1).join(':')}`;
    return [metricKey, Object.freeze({
      metricKey,
      displayName: definition.displayName,
      unit: definition.valueType === 'duration_seconds' ? 'seconds' : 'count',
      current: currentValue,
      compare: definition.comparisonEligible ? compareValue : null,
      change: definition.comparisonEligible ? change : null,
      changePercent: definition.comparisonEligible && change !== null && compareValue !== 0
        ? change / Math.abs(compareValue)
        : null,
      clientVisible: true,
      sortOrder: index + 1,
      formulaVersion,
      metricScope: definition.aggregation === 'latest_completed_day_value'
        ? 'current_total'
        : 'period_delta',
      availabilityStatus: currentValue === null
        ? (current.dataStatus === 'complete' ? 'not_observed' : 'source_unavailable')
        : 'available',
    })];
  })));
}

function summaryKeyForSourceField(sourceField, aggregation) {
  const match = CHATWOOT_REPORT_CONTRACT.summaryMetrics.find((metric) => (
    metric.sourceField === sourceField && metric.aggregation === aggregation
  ));
  if (!match) throw new Error(`Chatwoot Report contract missing ${sourceField}/${aggregation}`);
  return match.metricKey;
}
function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + requireNonNegative(row[field], field), 0);
}
function requireNonNegative(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${field} must be a non-negative number`);
  return number;
}
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Chatwoot Report metric must be finite');
  return number;
}
function requireRows(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return Object.freeze(value.map((row) => requireObject(row, `${fieldName} row`)));
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

import {
  CHATWOOT_REPORT_CONTRACT,
  CHATWOOT_REPORT_TOP_DIMENSION_LIMIT,
} from '../../../config/src/chatwoot-report-contract.js';

/** Build fixed-rank, PII-safe Inbox and Agent Metric rows for the shared Lark writer. */
export function buildChatwootDimensionMetricPayload(input = {}) {
  const platform = requireText(input.platform ?? 'chatwoot', 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const facts = requireRows(input.facts ?? [], 'facts');
  const coverageComplete = input.coverageComplete === true;
  const output = [];
  let sortOrder = 1;

  for (const dimension of CHATWOOT_REPORT_CONTRACT.dimensions) {
    for (const ranking of dimension.rankings) {
      const ranked = coverageComplete
        ? rankDimension(facts, dimension.entityField, ranking.sourceField)
        : [];
      for (let index = 0; index < CHATWOOT_REPORT_TOP_DIMENSION_LIMIT; index += 1) {
        const rank = index + 1;
        const source = ranked[index] ?? null;
        const sourceIdentity = source?.identity ?? null;
        const current = source?.value ?? null;
        const dimensionValue = `rank:${rank}`;
        const metricKey = ranking.metricKey.startsWith(`${platform}:`)
          ? ranking.metricKey
          : `${platform}:${ranking.metricKey.split(':').slice(1).join(':')}`;
        output.push(Object.freeze({
          metricKey,
          displayName: sourceIdentity
            ? `${ranking.displayName} #${rank} · ${displayIdentity(dimension.dimensionType, sourceIdentity)}`
            : `${ranking.displayName} #${rank} · ไม่มีข้อมูล`,
          unit: 'count',
          current,
          compare: null,
          change: null,
          changePercent: null,
          clientVisible: source !== null,
          sortOrder,
          formulaVersion,
          metricScope: 'period_delta',
          availabilityStatus: current === null
            ? (coverageComplete ? 'not_observed' : 'source_unavailable')
            : 'available',
          dimensionType: dimension.dimensionType,
          dimensionValue,
          rank,
          sourceDimensionValue: sourceIdentity,
          sourceDimensionLabel: sourceIdentity
            ? displayIdentity(dimension.dimensionType, sourceIdentity)
            : null,
        }));
        sortOrder += 1;
      }
    }
  }

  return Object.freeze(output);
}

function rankDimension(facts, entityField, valueField) {
  const totals = new Map();
  for (const row of facts) {
    const identity = opaqueIdentity(row[entityField]);
    if (!identity) continue;
    const value = nonNegativeFinite(row[valueField], valueField);
    totals.set(identity, (totals.get(identity) ?? 0) + value);
  }
  return [...totals.entries()]
    .map(([identity, value]) => Object.freeze({ identity, value }))
    .sort((left, right) => right.value - left.value || left.identity.localeCompare(right.identity))
    .slice(0, CHATWOOT_REPORT_TOP_DIMENSION_LIMIT);
}
function displayIdentity(dimensionType, identity) {
  return `${dimensionType === 'inbox' ? 'Inbox' : 'Agent'} ${identity}`;
}
function opaqueIdentity(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/u.test(text)) throw new TypeError('Chatwoot Report dimension identity must be opaque numeric text');
  return text;
}
function nonNegativeFinite(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
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

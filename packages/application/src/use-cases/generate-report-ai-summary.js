import { validateReportMaterializationPayload } from '../reports/report-materialization-payload.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/**
 * AI application boundary. The provider receives only a validated materialization payload and
 * explicit instructions not to recalculate metrics or replace null with zero.
 */
export async function generateReportAiSummary(input = {}) {
  const payload = validateReportMaterializationPayload(input.materializationPayload);
  const enabled = input.enabled === true;
  if (!enabled) return Object.freeze({ status: 'disabled', summary: null });
  const provider = requireProvider(input.provider);
  if (payload.dataStatus === 'source_unavailable' || payload.dataStatus === 'not_observed') {
    return Object.freeze({
      status: 'skipped',
      reason: payload.dataStatus,
      summary: null,
    });
  }
  const response = await provider.generate({
    schemaVersion: 'report-ai-summary-input-v1',
    language: requireText(input.language ?? 'th', 'language'),
    instructions: Object.freeze([
      'Explain only the supplied deterministic report materialization.',
      'Do not calculate, infer, aggregate or repair any metric.',
      'Preserve null as unknown and zero as observed zero.',
      'State coverage and data-status limitations explicitly.',
      'Do not recommend actions when coverage is partial unless clearly qualified.',
    ]),
    report: payload,
  });
  const summary = normalizeProviderResponse(response, payload);
  return Object.freeze({ status: 'completed', summary });
}

function normalizeProviderResponse(value, payload) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError('Report AI provider returned an invalid response', {
      code: 'REPORT_AI_PROVIDER_RESPONSE_INVALID',
    });
  }
  const narrative = requireText(value.narrative, 'provider.narrative');
  const recommendations = Array.isArray(value.recommendations)
    ? value.recommendations.map((item) => requireText(item, 'provider.recommendation'))
    : [];
  if (payload.dataStatus !== 'complete' && recommendations.length > 0 && value.coverageQualified !== true) {
    throw permanentError('Report AI recommendations must be coverage-qualified', {
      code: 'REPORT_AI_COVERAGE_QUALIFICATION_REQUIRED',
      details: { dataStatus: payload.dataStatus },
    });
  }
  return Object.freeze({
    schemaVersion: 'report-ai-summary-v1',
    narrative,
    recommendations: Object.freeze(recommendations),
    coverageQualified: value.coverageQualified === true,
    dataStatus: payload.dataStatus,
    coverageRate: payload.coverageRate,
    providerModel: optionalText(value.providerModel),
    generatedAt: requireEpoch(value.generatedAt ?? Date.now(), 'provider.generatedAt'),
  });
}

function requireProvider(value) {
  if (typeof value?.generate !== 'function') {
    throw permanentError('Report AI provider binding is unavailable', {
      code: 'REPORT_AI_PROVIDER_UNAVAILABLE',
    });
  }
  return value;
}
function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be epoch milliseconds`);
  return number;
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

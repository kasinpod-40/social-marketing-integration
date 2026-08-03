import { stableStringify } from '../../packages/application/src/use-cases/build-report-snapshot.js';
import { exactTerminalError, sha256Hex } from './lark-native-ai-controlled-preview-exact-terminal.js';

const REPORT_AVAILABILITY_TO_AI = Object.freeze({
  available: 'available',
  baseline_incomplete: 'baseline_incomplete',
  coverage_incomplete: 'coverage_incomplete',
  source_unavailable: 'not_available',
  not_observed: 'not_available',
  not_available: 'not_available',
});

/**
 * Adapt the Shared Report metric taxonomy to the Lark Native AI evidence taxonomy.
 *
 * Report `metric_scope` answers how a value was calculated (`period_delta`,
 * `current_total`, `data_quality`). AI `metric_scope` answers whether a value is
 * a channel summary or a dimensioned value. Preserve the original Report scope
 * in `source_metric_scope` and map only summary-dimension rows to AI `summary`.
 */
export async function adaptLarkNativeAiControlledPreviewReportSource(value) {
  const source = requireObject(value, 'sourcePackage');
  const adapted = structuredClone(source);
  delete adapted.packageSha256;
  delete adapted.package_sha256;

  const offlineInputs = requireArray(
    adapted.offlineInputs ?? adapted.offline_inputs,
    'sourcePackage.offlineInputs',
  );
  for (const [inputIndex, offlineInput] of offlineInputs.entries()) {
    const channels = requireArray(
      offlineInput?.channels,
      `sourcePackage.offlineInputs[${inputIndex}].channels`,
    );
    for (const [channelIndex, channel] of channels.entries()) {
      if (!channel?.report) continue;
      const metrics = requireArray(
        channel.report.metricValues ?? channel.report.metric_values ?? [],
        `sourcePackage.offlineInputs[${inputIndex}].channels[${channelIndex}].report.metricValues`,
      );
      for (const [metricIndex, metric] of metrics.entries()) {
        const label = `sourcePackage.offlineInputs[${inputIndex}].channels[${channelIndex}].report.metricValues[${metricIndex}]`;
        const row = requireObject(metric, label);
        const sourceMetricScope = requireIdentity(
          row.metric_scope ?? row.metricScope ?? 'period_delta',
          `${label}.metric_scope`,
        );
        const dimensionType = requireIdentity(
          row.dimension_type ?? row.dimensionType ?? 'summary',
          `${label}.dimension_type`,
        );
        const reportAvailability = requireIdentity(
          row.availability_status ?? row.availabilityStatus
            ?? ((row.current_value ?? row.currentValue) == null ? 'not_observed' : 'available'),
          `${label}.availability_status`,
        );
        const aiAvailability = REPORT_AVAILABILITY_TO_AI[reportAvailability];
        if (!aiAvailability) {
          throw exactTerminalError(
            'Report Metric availability cannot be mapped to the AI evidence contract',
            'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_AVAILABILITY_UNSUPPORTED',
            { reportAvailability, label },
          );
        }
        const currentValue = finiteOrNull(row.current_value ?? row.currentValue, `${label}.current_value`);
        const observed = currentValue !== null
          && reportAvailability !== 'source_unavailable'
          && reportAvailability !== 'not_observed';

        row.source_metric_scope = sourceMetricScope;
        row.metric_scope = dimensionType === 'summary' ? 'summary' : sourceMetricScope;
        row.availability_status = aiAvailability;
        row.observed = observed;
      }
    }
  }

  adapted.packageSha256 = await sha256Hex(stableStringify(adapted));
  return deepFreeze(adapted);
}

function finiteOrNull(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw exactTerminalError(
      `${label} must be finite when present`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_VALUE_INVALID',
      { label },
    );
  }
  return number;
}

function requireIdentity(value, label) {
  const item = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(item)) {
    throw exactTerminalError(
      `${label} is not a valid identity`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_METRIC_IDENTITY_INVALID',
      { label },
    );
  }
  return item;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw exactTerminalError(
      `${label} must be an object`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_ADAPTER_INVALID',
      { label },
    );
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw exactTerminalError(
      `${label} must be an array`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_ADAPTER_INVALID',
      { label },
    );
  }
  return value;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}

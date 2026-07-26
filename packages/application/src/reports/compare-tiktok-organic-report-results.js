import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';

const DEFAULT_FLOAT_TOLERANCE = 1e-9;
const MAX_MISMATCHES = 50;

/** Compare calculated report results without customer metadata or raw payloads. */
export async function compareTikTokOrganicReportResults(input = {}) {
  const primary = requireCalculation(input.primary, 'primary');
  const shadow = requireCalculation(input.shadow, 'shadow');
  const tolerance = nonNegativeNumber(
    input.floatTolerance ?? DEFAULT_FLOAT_TOLERANCE,
    'floatTolerance',
  );
  const fingerprint = typeof input.fingerprint === 'function'
    ? input.fingerprint
    : createStableFingerprint;
  const primaryContract = buildContract(primary);
  const shadowContract = buildContract(shadow);
  const mismatches = [];
  compareValue(primaryContract, shadowContract, '$', mismatches, tolerance);

  return Object.freeze({
    ok: mismatches.length === 0,
    mismatchCount: mismatches.length,
    mismatches: Object.freeze(mismatches.slice(0, MAX_MISMATCHES)),
    truncated: mismatches.length > MAX_MISMATCHES,
    floatTolerance: tolerance,
    primaryDigest: await fingerprint(primaryContract),
    shadowDigest: await fingerprint(shadowContract),
  });
}

function buildContract(value) {
  return Object.freeze({
    dataStatus: value.dataStatus,
    baselineCoverageRate: value.baselineCoverageRate,
    sourceSnapshotCount: value.sourceSnapshotCount,
    trackedContentCount: value.trackedContentCount,
    coveredContentCount: value.coveredContentCount,
    metrics: value.metrics,
    topContent: value.contentRows.map((row, index) => Object.freeze({
      rank: index + 1,
      externalContentId: row.content.externalContentId,
      baselineMode: row.baselineMode,
      dataStatus: row.dataStatus,
      periodViews: row.periodViews,
      periodEngagement: row.periodEngagement,
    })),
  });
}

function compareValue(left, right, path, mismatches, tolerance) {
  if (mismatches.length > MAX_MISMATCHES) return;
  if (typeof left === 'number' || typeof right === 'number') {
    if (!numbersEqual(left, right, tolerance)) mismatches.push(freezeMismatch(path, left, right));
    return;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    if (left !== right) mismatches.push(freezeMismatch(path, left, right));
    return;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      mismatches.push(freezeMismatch(`${path}.length`, left?.length ?? null, right?.length ?? null));
      return;
    }
    for (let index = 0; index < left.length; index += 1) {
      compareValue(left[index], right[index], `${path}[${index}]`, mismatches, tolerance);
    }
    return;
  }
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  for (const key of keys) {
    compareValue(left[key], right[key], `${path}.${key}`, mismatches, tolerance);
  }
}

function numbersEqual(left, right, tolerance) {
  if (left === null || left === undefined || right === null || right === undefined) return left === right;
  if (typeof left !== 'number' || typeof right !== 'number') return false;
  if (!Number.isFinite(left) || !Number.isFinite(right)) return Object.is(left, right);
  if (Number.isInteger(left) && Number.isInteger(right)) return left === right;
  return Math.abs(left - right) <= tolerance;
}

function freezeMismatch(path, primary, shadow) {
  return Object.freeze({ path, primary: primary ?? null, shadow: shadow ?? null });
}

function requireCalculation(value, fieldName) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.contentRows)) {
    throw new TypeError(`TikTok report parity requires ${fieldName} calculation`);
  }
  return value;
}

function nonNegativeNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}

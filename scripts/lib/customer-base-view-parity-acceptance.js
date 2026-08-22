import { verifyLarkBaseViewManualParityManifests } from './lark-base-view-manual-parity-manifest.js';

const EXCLUDED_WIDTH_CODE = 'VIEW_MANUAL_PARITY_COLUMN_WIDTHS_MISMATCH';

/**
 * Customer-specific acceptance wrapper for the manual View manifest verifier.
 *
 * Field order remains blocking. Column width is intentionally excluded by the
 * user's acceptance decision because Source widths were ad-hoc viewing changes,
 * not a product layout contract. No remote requests or mutations are performed.
 */
export function verifyCustomerBaseViewParityAcceptance(input) {
  const raw = verifyLarkBaseViewManualParityManifests(input);
  const excludedWidthMismatches = raw.mismatches.filter((item) => item?.code === EXCLUDED_WIDTH_CODE);
  const blockingMismatches = raw.mismatches.filter((item) => item?.code !== EXCLUDED_WIDTH_CODE);
  const rawPlan = raw.executionPlan ?? {};
  const rawManualOwned = rawPlan.manualOwned ?? {};

  const manualOwned = {
    fieldOrderViews: numberOrZero(rawManualOwned.fieldOrderViews),
    sortViews: numberOrZero(rawManualOwned.sortViews),
    groupViews: numberOrZero(rawManualOwned.groupViews),
    rowHeightViews: numberOrZero(rawManualOwned.rowHeightViews),
    frozenColumnViews: numberOrZero(rawManualOwned.frozenColumnViews),
  };

  const executionPlan = {
    ...structuredClone(rawPlan),
    manualOwned,
    userExcluded: {
      columnWidthViews: numberOrZero(rawManualOwned.columnWidthViews),
      columnWidthAssignments: numberOrZero(rawManualOwned.columnWidthAssignments),
      reason: 'column width is out of customer Base parity scope by explicit user decision',
    },
  };

  return deepFreeze({
    ok: blockingMismatches.length === 0,
    contractVersion: 'customer_base_view_parity_acceptance_v1',
    mode: 'local-read-only-id-redacted',
    acceptanceScope: {
      fieldOrder: 'blocking',
      sortInfo: 'blocking',
      group: 'blocking',
      rowHeightLevel: 'blocking',
      frozenColCount: 'blocking',
      columnWidth: 'excluded-by-user',
    },
    summary: {
      expectedTables: raw.summary?.expectedTables ?? 0,
      expectedViews: raw.summary?.expectedViews ?? 0,
      comparedViews: raw.summary?.comparedViews ?? 0,
      rawMismatchCount: raw.mismatches.length,
      blockingMismatchCount: blockingMismatches.length,
      excludedColumnWidthMismatchCount: excludedWidthMismatches.length,
      fieldOrderMismatchCount: blockingMismatches.filter((item) => item?.code === 'VIEW_MANUAL_PARITY_FIELD_ORDER_MISMATCH').length,
    },
    executionPlan,
    mismatches: blockingMismatches.map((item) => structuredClone(item)),
    excludedMismatches: excludedWidthMismatches.map((item) => structuredClone(item)),
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  });
}

function numberOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

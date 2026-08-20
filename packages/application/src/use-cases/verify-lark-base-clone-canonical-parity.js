import { verifyLarkBaseCloneCanonicalParity as verifyCore } from './verify-lark-base-clone-canonical-parity-core.js';
import {
  LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
  projectLarkBaseSourceForAutomaticViewFilterParity,
} from './lark-base-view-filter-parity.js';

/**
 * Canonical automatic parity verifier with explicit manual ownership for Source View
 * date predicates that the Base v3 View filter contract cannot persist semantically.
 */
export async function verifyLarkBaseCloneCanonicalParity(input) {
  const projection = projectLarkBaseSourceForAutomaticViewFilterParity(input?.sourceClient);
  const result = await verifyCore({ ...input, sourceClient: projection.client });
  const requirements = projection.getRequirements();
  if (requirements.length === 0) return result;
  return deepFreeze({
    ...result,
    summary: {
      ...result.summary,
      manualViewFilterRequirements: requirements.length,
    },
    coverage: {
      ...result.coverage,
      views: 'name-type-public-hidden-and-supported-filter-parity-with-field-id-remap; unsupported-dynamic-date-token-filter-is-ui-manual',
    },
    manualParity: {
      ...(result.manualParity ?? {}),
      viewFilters: {
        ownership: LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
        required: true,
        requirements,
      },
    },
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

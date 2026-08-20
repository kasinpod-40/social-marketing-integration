import {
  applyLarkBaseConsolidation as applyCore,
  previewLarkBaseConsolidation as previewCore,
  verifyLarkBaseConsolidation as verifyCore,
} from './consolidate-lark-base-core.js';
import {
  LARK_BASE_MANUAL_DYNAMIC_DATE_VIEW_FILTER_OWNERSHIP,
  projectLarkBaseSourceForAutomaticViewFilterParity,
} from './lark-base-view-filter-parity.js';

export async function previewLarkBaseConsolidation(input) {
  return runWithAutomaticViewFilterProjection(previewCore, input);
}

export async function applyLarkBaseConsolidation(input) {
  return runWithAutomaticViewFilterProjection(applyCore, input);
}

export async function verifyLarkBaseConsolidation(input) {
  return runWithAutomaticViewFilterProjection(verifyCore, input);
}

async function runWithAutomaticViewFilterProjection(operation, input) {
  const projection = projectLarkBaseSourceForAutomaticViewFilterParity(input?.sourceClient);
  const result = await operation({ ...input, sourceClient: projection.client });
  const requirements = projection.getRequirements();
  if (requirements.length === 0) return result;
  return deepFreeze({
    ...result,
    manualViewFilters: requirements,
    manualViewFilterCount: requirements.length,
    manualParity: {
      ...(result?.manualParity ?? {}),
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

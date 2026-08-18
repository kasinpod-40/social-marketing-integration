const IMPLEMENTED_VIEW_MUTATIONS = Object.freeze(new Set(['hiddenFields', 'filterInfo']));
const MANUAL_VIEW_PARITY_FEATURES = Object.freeze(new Set([
  'fieldOrder',
  'sortInfo',
  'group',
  'colInfos',
  'rowHeightLevel',
  'frozenColCount',
]));

/**
 * Read-only classification of clone-scope parity coverage.
 *
 * This use case does not call remote APIs by itself and exposes no mutation path.
 * It inspects the Source adapter contract that will feed the shared consolidator
 * and reports every represented dimension that is not yet covered by deterministic
 * clone + canonical verification logic or an explicit verified manual parity path.
 */
export async function assessLarkBaseCloneParityCoverage(input) {
  const sourceClient = requireSourceClient(input?.sourceClient);
  const exportCounts = normalizeExportCounts(input?.exportCounts);
  const tables = await sourceClient.listTables();
  const viewFeatureCounts = emptyViewFeatureCounts();
  const viewTypes = new Map();
  let viewCount = 0;

  for (const table of tables) {
    const tableId = requireText(table?.tableId, 'source tableId');
    const views = await sourceClient.listViews({ tableId });
    viewCount += views.length;
    for (const view of views) {
      const type = normalizeOptionalText(view?.viewType) ?? 'unknown';
      viewTypes.set(type, (viewTypes.get(type) ?? 0) + 1);
      countViewFeatures(view, viewFeatureCounts);
    }
  }

  const blockers = [];
  const dimensions = [];

  addDimension(dimensions, blockers, {
    dimension: 'table_field_record_clone',
    represented: tables.length > 0,
    status: 'canonical_verifier_implemented_apply_wiring_pending',
    blockerCode: 'CLONE_PARITY_CANONICAL_TABLE_FIELD_RECORD_VERIFY_WIRING_PENDING',
    message: 'Canonical full-readable Field/Record verification is implemented and CI-verified, but it is not yet wired into the only controlled post-Apply verification path.',
  });

  addDimension(dimensions, blockers, {
    dimension: 'relation_formula_remap',
    represented: exportCounts.relationFields > 0 || exportCounts.formulaFields > 0,
    status: 'canonical_verifier_implemented_apply_wiring_pending',
    blockerCode: 'CLONE_PARITY_RELATION_FORMULA_VERIFY_WIRING_PENDING',
    message: 'Canonical Relation/Formula ID-remap verification is implemented and CI-verified, but it is not yet wired into the only controlled post-Apply verification path.',
    details: {
      relationFields: exportCounts.relationFields,
      formulaFields: exportCounts.formulaFields,
    },
  });

  addDimension(dimensions, blockers, {
    dimension: 'view_hidden_filter',
    represented: viewFeatureCounts.hiddenFields > 0 || viewFeatureCounts.filterInfo > 0,
    status: 'canonical_verifier_implemented_apply_wiring_pending',
    blockerCode: 'CLONE_PARITY_VIEW_CANONICAL_VERIFY_WIRING_PENDING',
    message: 'Canonical View type/public/hidden/filter verification is implemented and CI-verified, but it is not yet wired into the only controlled post-Apply verification path.',
    details: {
      hiddenFieldViews: viewFeatureCounts.hiddenFields,
      filteredViews: viewFeatureCounts.filterInfo,
    },
  });

  const unsupportedViewFeatures = Object.freeze([
    ['fieldOrder', 'visible-field order'],
    ['sortInfo', 'sort'],
    ['group', 'group'],
    ['colInfos', 'column configuration'],
    ['rowHeightLevel', 'row-height'],
    ['frozenColCount', 'frozen columns'],
    ['cardViewSetting', 'card configuration'],
    ['colorInfo', 'color configuration'],
  ]);
  for (const [feature, label] of unsupportedViewFeatures) {
    const count = viewFeatureCounts[feature];
    const manualParityImplemented = MANUAL_VIEW_PARITY_FEATURES.has(feature);
    addDimension(dimensions, blockers, {
      dimension: `view_${feature}`,
      represented: count > 0,
      status: IMPLEMENTED_VIEW_MUTATIONS.has(feature)
        ? 'implemented_verify_incomplete'
        : manualParityImplemented
          ? 'manual_manifest_verifier_implemented_execution_pending'
          : 'documented_write_contract_not_proven',
      blockerCode: manualParityImplemented
        ? `CLONE_PARITY_VIEW_${camelToUpperSnake(feature)}_MANUAL_EXECUTION_PENDING`
        : `CLONE_PARITY_VIEW_${camelToUpperSnake(feature)}_DOCUMENTED_WRITE_CONTRACT_NOT_PROVEN`,
      message: manualParityImplemented
        ? `Source clone scope contains ${count} View(s) with ${label}; no safe documented automatic write contract is proven, but an exact ID-redacted manual manifest and local manifest verifier are implemented and CI-verified. Post-Apply manual execution remains pending.`
        : `Source clone scope contains ${count} View(s) with ${label}; no safe documented write contract or verified manual parity path has been proven, so parity remains fail-closed.`,
      details: { views: count },
    });
  }

  addDimension(dimensions, blockers, {
    dimension: 'view_hierarchyConfig',
    represented: viewFeatureCounts.hierarchyConfig > 0,
    status: 'documented_implementation_ci_verified_apply_wiring_pending',
    blockerCode: 'CLONE_PARITY_VIEW_HIERARCHY_CONFIG_WIRING_PENDING',
    message: 'Documented hierarchy_config Field-ID remap, idempotent PATCH and GET read-back are implemented and CI-verified, but the phase is not yet wired into the only controlled Apply path.',
    details: { views: viewFeatureCounts.hierarchyConfig },
  });

  const formViews = viewTypes.get('form') ?? 0;
  addDimension(dimensions, blockers, {
    dimension: 'forms_questions',
    represented: formViews > 0,
    status: formViews > 0 ? 'clone_not_implemented' : 'not_represented_in_clone_source',
    blockerCode: 'CLONE_PARITY_FORMS_QUESTIONS_UNIMPLEMENTED',
    message: `Source clone scope contains ${formViews} Form View(s); Form/Question parity is not implemented yet.`,
    details: { formViews },
  });

  addDimension(dimensions, blockers, {
    dimension: 'dashboards',
    represented: exportCounts.dashboards > 0,
    status: 'official_capability_requires_implementation',
    blockerCode: 'CLONE_PARITY_DASHBOARD_UNIMPLEMENTED',
    message: 'The approved export contains Dashboards, but export-to-target Dashboard clone/remap/canonical verification is not implemented.',
    details: { dashboards: exportCounts.dashboards },
  });

  addDimension(dimensions, blockers, {
    dimension: 'workflows',
    represented: exportCounts.workflows > 0,
    status: 'official_capability_requires_implementation',
    blockerCode: 'CLONE_PARITY_WORKFLOW_UNIMPLEMENTED',
    message: 'The approved export contains Workflows/Automations, but deterministic definition/state replay and canonical verification are not implemented.',
    details: { workflows: exportCounts.workflows },
  });

  addDimension(dimensions, blockers, {
    dimension: 'advanced_permissions',
    represented: exportCounts.advancedPermissionRoles > 0,
    status: 'documented_plan_fence_transport_verifier_implemented_apply_wiring_pending',
    blockerCode: 'CLONE_PARITY_ADVANCED_PERMISSION_WIRING_PENDING',
    message: 'Advanced Permission semantic planning, orphan-reference handling, pre-existing Target role fencing, documented role transport and GET-only verifier are implemented and CI-verified; controlled Apply wiring and partial-write recovery remain pending.',
    details: { advancedPermissionRoles: exportCounts.advancedPermissionRoles },
  });

  return deepFreeze({
    ok: blockers.length === 0,
    contractVersion: 'customer_base_clone_parity_coverage_v4',
    mode: 'read-only',
    source: {
      tables: tables.length,
      views: viewCount,
      viewTypes: Object.fromEntries([...viewTypes.entries()].sort(([left], [right]) => left.localeCompare(right))),
      viewFeatureCounts,
      exportResourceCounts: exportCounts,
    },
    canonicalVerifier: {
      contractVersion: 'customer_base_clone_canonical_verifier_v1',
      implementationStatus: 'implemented_ci_verified_apply_wiring_pending',
      coverage: [
        'full-readable Field configuration',
        'Relation table ID remap',
        'Formula table/field ID remap',
        'all readable Record field values',
        'Relation record ID remap',
        'View type/public/hidden/filter with Field ID remap',
      ],
    },
    documentedViewParity: {
      contractVersion: 'customer_base_documented_view_parity_v1',
      implementationStatus: 'hierarchy_config_implemented_ci_verified_apply_wiring_pending',
      hierarchyConfig: 'documented-field-id-remap-patch-readback',
    },
    manualViewParity: {
      manifestContractVersion: 'customer_base_view_manual_parity_manifest_v1',
      executionPlanContractVersion: 'customer_base_view_manual_parity_execution_plan_v1',
      verifierContractVersion: 'customer_base_view_manual_parity_verifier_v1',
      implementationStatus: 'implemented_ci_verified_post_apply_execution_pending',
      automaticExcluded: ['hidden fields', 'filters', 'hierarchy'],
      manualOwned: ['field order', 'sort', 'group', 'explicit non-null column widths', 'row height', 'frozen columns'],
    },
    advancedPermissionParity: {
      implementationStatus: 'plan_fence_transport_verifier_implemented_ci_verified_apply_wiring_pending',
    },
    dimensions,
    blockers,
    remoteMutationCount: 0,
  });
}

function countViewFeatures(view, counts) {
  const property = view?.property && typeof view.property === 'object' ? view.property : {};
  if (Array.isArray(property.hiddenFields) && property.hiddenFields.length > 0) counts.hiddenFields += 1;
  if (property.filterInfo) counts.filterInfo += 1;
  if (Array.isArray(property.fieldOrder) && property.fieldOrder.length > 0) counts.fieldOrder += 1;
  if (Array.isArray(property.sortInfo) && property.sortInfo.length > 0) counts.sortInfo += 1;
  if (Array.isArray(property.group) && property.group.length > 0) counts.group += 1;
  if (property.colInfos && typeof property.colInfos === 'object' && Object.keys(property.colInfos).length > 0) counts.colInfos += 1;
  if (property.rowHeightLevel !== null && property.rowHeightLevel !== undefined) counts.rowHeightLevel += 1;
  if (Number.isFinite(Number(property.frozenColCount)) && Number(property.frozenColCount) > 0) counts.frozenColCount += 1;
  if (property.cardViewSetting) counts.cardViewSetting += 1;
  if (property.hierarchyConfig) counts.hierarchyConfig += 1;
  if (property.colorInfo) counts.colorInfo += 1;
  if (view?.publicLevel !== null && view?.publicLevel !== undefined) counts.publicLevel += 1;
}

function emptyViewFeatureCounts() {
  return {
    hiddenFields: 0,
    filterInfo: 0,
    fieldOrder: 0,
    sortInfo: 0,
    group: 0,
    colInfos: 0,
    rowHeightLevel: 0,
    frozenColCount: 0,
    cardViewSetting: 0,
    hierarchyConfig: 0,
    colorInfo: 0,
    publicLevel: 0,
  };
}

function addDimension(dimensions, blockers, input) {
  const represented = input.represented === true;
  const status = represented ? input.status : 'not_represented';
  const dimension = deepFreeze({
    dimension: input.dimension,
    represented,
    status,
    details: structuredClone(input.details ?? {}),
  });
  dimensions.push(dimension);
  if (!represented || status === 'implemented' || status === 'not_represented') return;
  blockers.push(problem(input.blockerCode, input.message, {
    dimension: input.dimension,
    status,
    ...(input.details ?? {}),
  }));
}

function normalizeExportCounts(value) {
  const source = value && typeof value === 'object' ? value : {};
  return deepFreeze({
    relationFields: nonNegativeNumber(source.relationFields),
    formulaFields: nonNegativeNumber(source.formulaFields),
    dashboards: nonNegativeNumber(source.dashboards),
    workflows: nonNegativeNumber(source.workflows),
    advancedPermissionRoles: nonNegativeNumber(source.advancedPermissionRoles),
  });
}

function nonNegativeNumber(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new TypeError('export count must be a non-negative number');
  return number;
}

function requireSourceClient(client) {
  for (const method of ['listTables', 'listViews']) {
    if (!client || typeof client[method] !== 'function') throw new TypeError(`sourceClient must implement ${method}()`);
  }
  return client;
}

function camelToUpperSnake(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toUpperCase();
}

function normalizeOptionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const normalized = normalizeOptionalText(value);
  if (!normalized) throw new TypeError(`${name} is required`);
  return normalized;
}

function problem(code, message, details = {}) {
  return deepFreeze({ code, message, details: structuredClone(details) });
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

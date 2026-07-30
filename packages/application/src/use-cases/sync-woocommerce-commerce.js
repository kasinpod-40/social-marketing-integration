import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';
import {
  WOOCOMMERCE_DATASETS,
  WOOCOMMERCE_LARK_TABLES,
  createWooCommerceIncrementalBoundary,
  normalizeWooCommerceDataset,
} from '../commerce/woocommerce-commerce-model.js';

const PHASE = 'woocommerce_commerce_pages_v1';
const SCHEMA_VERSION = 'woocommerce-commerce-v1';
const DEFAULT_MAX_PAGES_PER_INVOCATION = 2;
const DEFAULT_NESTED_CONCURRENCY = 3;
const DATASET_PLAN = Object.freeze([
  Object.freeze({ dataset: WOOCOMMERCE_DATASETS.STORE, resource: null, entityType: 'store' }),
  Object.freeze({ dataset: WOOCOMMERCE_DATASETS.ORDERS, resource: 'orders', entityType: 'order' }),
  Object.freeze({ dataset: WOOCOMMERCE_DATASETS.PRODUCTS, resource: 'products', entityType: 'product' }),
  Object.freeze({ dataset: WOOCOMMERCE_DATASETS.CATEGORIES, resource: 'products/categories', entityType: 'category' }),
  Object.freeze({ dataset: WOOCOMMERCE_DATASETS.CUSTOMERS, resource: 'customers', entityType: 'customer' }),
  Object.freeze({ dataset: WOOCOMMERCE_DATASETS.COUPONS, resource: 'coupons', entityType: 'coupon' }),
]);

/**
 * Resumable WooCommerce Commerce ingestion.
 * Shared Reliability owns lock acquisition/renewal, Queue retry and DLQ. This use case owns
 * Source pagination, privacy-minimized normalization, D1-first writes, Lark repair and Coverage.
 */
export async function syncWooCommerceCommerce(input = {}) {
  const dependencies = readDependencies(input);
  const reference = normalizeReference(input);
  const runtime = normalizeRuntime(input);
  assertExecutionGates(runtime);

  // Mutable Source-window inputs are persisted in the durable phase before any Source read.
  // The Work fingerprint identifies the generation/account; durable scope is authoritative
  // for every continuation of that generation.
  const operationFingerprint = await createStableFingerprint({
    contract: SCHEMA_VERSION,
    workKey: reference.workKey,
    generation: reference.generation,
    customerKey: runtime.customerKey,
    accountKey: runtime.accountKey,
  });
  const begun = await dependencies.resumableWorkStore.beginWork({
    workKey: reference.workKey,
    cursorKey: reference.cursorKey,
    workType: reference.type,
    operationFingerprint,
    generation: reference.generation,
    requestedAt: reference.originalRequestedAt,
  });
  if (begun.superseded) return Object.freeze({ status: 'superseded', workKey: reference.workKey });
  if (begun.completed) {
    return Object.freeze({
      status: 'completed_idempotent',
      workKey: reference.workKey,
      reconciliation: begun.completion ?? null,
    });
  }

  await dependencies.assertLockActive();
  await dependencies.commerceStore.assertSchemaReady();
  let phase = await dependencies.resumableWorkStore.loadPhase({
    workKey: reference.workKey,
    phase: PHASE,
  });
  let state = normalizeState(phase?.state, createExecutionScope(runtime));

  // Persist immutable scope before the first provider call. A crash or continuation can then
  // rehydrate the exact same full/incremental window without putting Source parameters in Queue.
  if (!phase) {
    const saved = await dependencies.resumableWorkStore.savePhase({
      workKey: reference.workKey,
      phase: PHASE,
      state,
      expectedItems: DATASET_PLAN.length,
      processedItems: 0,
      pagesProcessed: 0,
      chunksProcessed: 0,
      complete: false,
    });
    state = normalizeState(saved?.state ?? state, state.scope);
    phase = saved ?? Object.freeze({ state });
  }

  let pagesThisInvocation = 0;
  while (state.datasetIndex < DATASET_PLAN.length
    && pagesThisInvocation < runtime.maxPagesPerInvocation) {
    await dependencies.assertLockActive();
    await dependencies.resumableWorkStore.assertCurrentGeneration?.({
      workKey: reference.workKey,
      cursorKey: reference.cursorKey,
      generation: reference.generation,
    });

    const contract = DATASET_PLAN[state.datasetIndex];
    const coverageRunId = `${reference.syncRunId}:woocommerce:${contract.dataset}`;
    const sourcePage = await fetchDatasetPage({
      contract,
      state,
      scope: state.scope,
      client: dependencies.client,
      now: runtime.now,
    });
    const pageResult = applyBoundedHistoryFilter({
      contract,
      pageResult: sourcePage,
      state,
      scope: state.scope,
    });
    const enriched = await enrichNestedResources({
      contract,
      records: pageResult.records,
      client: dependencies.client,
      concurrency: state.scope.nestedConcurrency,
      maxNestedPages: state.scope.maxNestedPages,
    });
    const normalized = await normalizePage({
      contract,
      pageResult,
      enriched,
      scope: state.scope,
      storeContext: state.storeContext,
      reference,
      coverageRunId,
      now: runtime.now,
    });

    const directPlans = await planLarkRows({
      output: normalized,
      repository: dependencies.repository,
      syncEngine: dependencies.syncEngine,
      tables: dependencies.tables,
      includeDerived: false,
    });

    await dependencies.assertLockActive();
    const d1Result = await dependencies.commerceStore.upsertRowsByTable(normalized.d1RowsByTable);
    const derivedResult = await dependencies.commerceStore.rebuildDerivedFacts({
      accountKey: runtime.accountKey,
      metricDates: normalized.impactedDates,
      customerAggregateKeys: normalized.impactedCustomers,
      syncRunId: reference.syncRunId,
      coverageRunId,
      dataStatus: state.scope.fullReconciliation ? 'partial' : 'revisable',
      now: runtime.now(),
    });
    const derivedRows = await dependencies.commerceStore.readDerivedRows({
      accountKey: runtime.accountKey,
      metricDates: normalized.impactedDates,
      customerAggregateKeys: normalized.impactedCustomers,
    });
    const derivedOutput = createDerivedOutput(derivedRows);
    const derivedPlans = await planLarkRows({
      output: derivedOutput,
      repository: dependencies.repository,
      syncEngine: dependencies.syncEngine,
      tables: dependencies.tables,
      includeDerived: true,
      derivedOnly: true,
    });

    const larkResults = [];
    for (const plan of [...directPlans, ...derivedPlans]) {
      await dependencies.assertLockActive();
      const result = await dependencies.syncEngine.executePlan(plan.plan, {
        beforeWriteChunk: dependencies.assertLockActive,
      });
      larkResults.push(Object.freeze({
        tableKey: plan.tableKey,
        expected: plan.expected,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      }));
    }

    const observedAt = runtime.now();
    const observedEntities = buildCoverageEntities({
      records: pageResult.records,
      entityType: contract.entityType,
      coverageRunId,
      observedAt,
    });
    if (observedEntities.length > 0) {
      await dependencies.coverageStore.saveCoverageEntities(observedEntities);
    }

    const storeContext = contract.dataset === WOOCOMMERCE_DATASETS.STORE
      ? resolveStoreContext(pageResult.records[0], state.scope)
      : state.storeContext;
    state = advanceState({
      state,
      contract,
      pageResult,
      normalized,
      d1Result,
      derivedResult,
      larkResults,
      storeContext,
    });
    const datasetComplete = pageResult.nextPage === null;
    const coverageRun = buildCoverageRun({
      reference,
      scope: state.scope,
      accountKey: runtime.accountKey,
      customerKey: runtime.customerKey,
      contract,
      state,
      coverageRunId,
      pageResult,
      complete: datasetComplete,
      now: runtime.now,
    });
    await dependencies.coverageStore.saveCoverageRun(coverageRun);

    if (datasetComplete && contract.dataset === WOOCOMMERCE_DATASETS.ORDERS
      && typeof dependencies.commerceStore.finalizeOrderDerivedFacts === 'function') {
      const dataStatus = state.scope.fullReconciliation && coverageRun.status === 'complete'
        ? 'complete'
        : state.scope.fullReconciliation ? 'partial' : 'revisable';
      await dependencies.commerceStore.finalizeOrderDerivedFacts({
        accountKey: runtime.accountKey,
        coverageRunId,
        dataStatus,
        now: runtime.now(),
      });
    }

    if (datasetComplete) {
      state = Object.freeze({ ...state, datasetIndex: state.datasetIndex + 1, page: 1 });
    } else {
      state = Object.freeze({ ...state, page: pageResult.nextPage });
    }

    pagesThisInvocation += 1;
    phase = await dependencies.resumableWorkStore.savePhase({
      workKey: reference.workKey,
      phase: PHASE,
      state,
      expectedItems: DATASET_PLAN.length,
      processedItems: state.datasetIndex,
      pagesProcessed: state.counts.pages,
      chunksProcessed: state.counts.pages,
      complete: state.datasetIndex >= DATASET_PLAN.length,
      unit: {
        unitKey: `${contract.dataset}:page:${pageResult.page}`,
        sequence: state.counts.pages - 1,
        payload: {
          dataset: contract.dataset,
          page: pageResult.page,
          sourceRows: pageResult.records.length,
          d1Rows: d1Result.totalRows,
          larkRows: sumLarkRows(larkResults),
        },
      },
    });
    state = normalizeState(phase?.state ?? state, state.scope);
  }

  if (state.datasetIndex < DATASET_PLAN.length) {
    await queueContinuation(dependencies.continuationQueue, reference);
    return Object.freeze({
      status: 'continuation_queued',
      workKey: reference.workKey,
      continuationQueued: true,
      progress: summarizeProgress(state),
    });
  }

  const reconciliation = createReconciliation(reference, state);
  await dependencies.assertLockActive();
  await dependencies.resumableWorkStore.completeWork({
    workKey: reference.workKey,
    completion: reconciliation,
  });
  return Object.freeze({ status: 'completed', workKey: reference.workKey, reconciliation });
}

async function fetchDatasetPage({ contract, state, scope, client, now }) {
  if (contract.dataset === WOOCOMMERCE_DATASETS.STORE) {
    const store = await client.getStoreIdentity();
    return Object.freeze({
      page: 1,
      totalPages: 1,
      totalRows: 1,
      nextPage: null,
      sourceWatermark: now(),
      records: Object.freeze([store]),
    });
  }
  return client.listPage(contract.resource, {
    page: state.page,
    perPage: scope.pageSize,
    params: buildSourceParams(contract.dataset, scope),
  });
}

function buildSourceParams(dataset, scope) {
  const params = {};
  if ([WOOCOMMERCE_DATASETS.ORDERS, WOOCOMMERCE_DATASETS.PRODUCTS].includes(dataset)) {
    params.order = 'asc';
    params.orderby = 'modified';
    params.dates_are_gmt = true;
    if (scope.incrementalBoundary) params.modified_after = scope.incrementalBoundary;
  }
  if (dataset === WOOCOMMERCE_DATASETS.ORDERS) {
    params.status = 'any';
    params.dp = 6;
    if (scope.orderCreatedAfter !== null) {
      // WooCommerce/WordPress date queries are strictly "after". Ask from the
      // preceding millisecond, then enforce the exact immutable boundary locally.
      params.after = new Date(Math.max(0, scope.orderCreatedAfter - 1)).toISOString();
    }
    if (scope.orderCreatedBefore !== null) {
      params.before = new Date(scope.orderCreatedBefore).toISOString();
    }
  }
  return params;
}

function applyBoundedHistoryFilter(input) {
  if (input.scope.orderCreatedAfter === null
    || ![
      WOOCOMMERCE_DATASETS.ORDERS,
      WOOCOMMERCE_DATASETS.CUSTOMERS,
      WOOCOMMERCE_DATASETS.COUPONS,
    ]
      .includes(input.contract.dataset)) {
    return input.pageResult;
  }
  const records = input.pageResult.records.filter((record) => {
    const createdAt = nullableTimestamp(
      record?.date_created_gmt ?? record?.date_created,
      `${input.contract.dataset}.date_created`,
    );
    return createdAt !== null
      && createdAt >= input.scope.orderCreatedAfter
      && (input.scope.orderCreatedBefore === null
        || createdAt < input.scope.orderCreatedBefore);
  });
  const current = input.state.datasetCounts[input.contract.dataset]
    ?? emptyDatasetCount();
  return Object.freeze({
    ...input.pageResult,
    records: Object.freeze(records),
    totalRows: input.pageResult.nextPage === null
      ? current.sourceRows + records.length
      : input.pageResult.totalRows,
  });
}

async function enrichNestedResources(input) {
  const refundsByOrderId = new Map();
  const variationsByProductId = new Map();
  if (input.contract.dataset === WOOCOMMERCE_DATASETS.ORDERS) {
    const orders = input.records.filter((order) => shouldFetchRefunds(order));
    const pairs = await mapBounded(orders, input.concurrency, async (order) => [
      positiveInteger(order.id, 'order.id'),
      await readAllNestedPages(
        (page) => input.client.listOrderRefunds(order.id, { page }),
        input.maxNestedPages,
      ),
    ]);
    for (const [orderId, refunds] of pairs) refundsByOrderId.set(orderId, refunds);
  }
  if (input.contract.dataset === WOOCOMMERCE_DATASETS.PRODUCTS) {
    const products = input.records.filter((product) => shouldFetchVariations(product));
    const pairs = await mapBounded(products, input.concurrency, async (product) => [
      positiveInteger(product.id, 'product.id'),
      await readAllNestedPages(
        (page) => input.client.listProductVariations(product.id, { page }),
        input.maxNestedPages,
      ),
    ]);
    for (const [productId, variations] of pairs) variationsByProductId.set(productId, variations);
  }
  return Object.freeze({ refundsByOrderId, variationsByProductId });
}

async function readAllNestedPages(fetchPage, maxPages) {
  const records = [];
  let page = 1;
  while (page <= maxPages) {
    const result = await fetchPage(page);
    records.push(...result.records);
    if (result.nextPage === null) return Object.freeze(records);
    page = result.nextPage;
  }
  throw transientError('WooCommerce nested pagination exceeded its bound', {
    code: 'WOOCOMMERCE_NESTED_PAGINATION_BOUND_EXCEEDED',
    details: { maxPages },
  });
}

async function normalizePage({
  contract, pageResult, enriched, scope, storeContext, reference, coverageRunId, now,
}) {
  const effective = contract.dataset === WOOCOMMERCE_DATASETS.STORE
    ? resolveStoreContext(pageResult.records[0], scope)
    : resolveStoreContext(storeContext, scope);
  const common = {
    dataset: contract.dataset,
    records: pageResult.records,
    customerKey: scope.customerKey,
    accountKey: scope.accountKey,
    reportingTimezone: effective.reportingTimezone,
    defaultCurrency: effective.defaultCurrency,
    syncRunId: reference.syncRunId,
    coverageRunId,
    fetchedAt: now(),
    now: now(),
    refundsByOrderId: enriched.refundsByOrderId,
  };
  let output = await normalizeWooCommerceDataset(common);
  if (contract.dataset === WOOCOMMERCE_DATASETS.PRODUCTS) {
    for (const [parentProductId, variations] of enriched.variationsByProductId.entries()) {
      const variationOutput = await normalizeWooCommerceDataset({
        ...common,
        dataset: WOOCOMMERCE_DATASETS.VARIATIONS,
        records: variations,
        parentProductId,
      });
      output = mergeNormalizedOutputs(output, variationOutput);
    }
  }
  return output;
}

async function planLarkRows(input) {
  const plans = [];
  for (const contract of WOOCOMMERCE_LARK_TABLES) {
    const derived = contract.path.startsWith('daily.') || contract.path === 'canonical.customers';
    if (input.derivedOnly === true && !derived) continue;
    if (input.includeDerived !== true && derived) continue;
    const rows = readPath(input.output, contract.path);
    if (rows.length === 0) continue;
    const tableId = requireText(input.tables[contract.tableKey], contract.tableKey);
    const plan = await input.syncEngine.planByKey({
      repository: input.repository,
      tableId,
      keyField: contract.keyField,
      rows,
    });
    if (plan.duplicateInputRows !== 0) {
      throw permanentError('WooCommerce Lark preflight found duplicate Stable keys', {
        code: 'WOOCOMMERCE_LARK_DUPLICATE_INPUT',
        details: { tableKey: contract.tableKey, duplicateRows: plan.duplicateInputRows },
      });
    }
    plans.push(Object.freeze({ tableKey: contract.tableKey, expected: rows.length, plan }));
  }
  return Object.freeze(plans);
}

function createDerivedOutput(rows) {
  return Object.freeze({
    raw: emptyRaw(),
    canonical: Object.freeze({
      orders: Object.freeze([]),
      orderStatusObservations: Object.freeze([]),
      orderLines: Object.freeze([]),
      products: Object.freeze([]),
      customers: rows.customers,
    }),
    daily: Object.freeze({ sales: rows.sales, products: rows.products }),
  });
}

function emptyRaw() {
  return Object.freeze({
    stores: Object.freeze([]), orders: Object.freeze([]), orderItems: Object.freeze([]),
    products: Object.freeze([]), variations: Object.freeze([]), categories: Object.freeze([]),
    customers: Object.freeze([]), coupons: Object.freeze([]), refunds: Object.freeze([]),
  });
}

function buildCoverageEntities(input) {
  return Object.freeze(input.records.map((record, index) => {
    const externalId = record?.id ?? (input.entityType === 'store' ? 'store' : `row-${index + 1}`);
    return Object.freeze({
      coverage_entity_key: `${input.coverageRunId}:${input.entityType}:${externalId}`,
      coverage_run_id: input.coverageRunId,
      entity_type: input.entityType,
      external_entity_id: String(externalId),
      observation_status: 'observed',
      source_revision: sourceRevision(record),
      observed_at: input.observedAt,
      created_at: input.observedAt,
    });
  }));
}

function buildCoverageRun(input) {
  const datasetState = input.state.datasetCounts[input.contract.dataset] ?? emptyDatasetCount();
  const expected = input.pageResult.totalRows;
  const observed = datasetState.sourceRows;
  const boundedDataset = [
    WOOCOMMERCE_DATASETS.ORDERS,
    WOOCOMMERCE_DATASETS.CUSTOMERS,
    WOOCOMMERCE_DATASETS.COUPONS,
  ].includes(input.contract.dataset)
    && input.scope.orderCreatedAfter !== null;
  const status = input.complete
    ? (expected === 0 ? 'no_data_confirmed' : observed === expected ? 'complete' : 'partial')
    : 'partial';
  const now = input.now();
  return Object.freeze({
    coverage_run_id: input.coverageRunId,
    sync_run_id: input.reference.syncRunId,
    customer_key: input.customerKey,
    platform: 'woocommerce',
    account_key: input.accountKey,
    dataset_key: `woocommerce_${input.contract.dataset}`,
    metric_semantics: 'snapshot',
    scope_mode: boundedDataset
      ? 'report_range'
      : input.scope.fullReconciliation ? 'full_inventory' : 'recent_window',
    period_start: boundedDataset ? utcDate(input.scope.orderCreatedAfter) : null,
    period_end: boundedDataset && input.scope.orderCreatedBefore !== null
      ? utcDate(input.scope.orderCreatedBefore)
      : null,
    source_timezone: input.state.storeContext.reportingTimezone ?? input.scope.reportingTimezone,
    status,
    expected_entities: expected,
    observed_entities: observed,
    expected_rows: expected,
    observed_rows: observed,
    written_rows: datasetState.d1Rows,
    failed_rows: 0,
    source_watermark: datasetState.sourceWatermark === null
      ? null
      : String(datasetState.sourceWatermark),
    revisable_until: input.contract.dataset === WOOCOMMERCE_DATASETS.ORDERS
      ? now + input.scope.revisionLookbackMs
      : null,
    started_at: input.reference.originalRequestedAt,
    completed_at: input.complete ? now : null,
    error_code: null,
    created_at: input.reference.originalRequestedAt,
    updated_at: now,
  });
}

function advanceState(input) {
  const datasetCounts = { ...input.state.datasetCounts };
  const current = { ...(datasetCounts[input.contract.dataset] ?? emptyDatasetCount()) };
  current.pages += 1;
  current.sourceRows += input.pageResult.records.length;
  current.d1Rows += input.d1Result.totalRows;
  current.derivedRows += input.derivedResult.salesRows
    + input.derivedResult.productRows
    + input.derivedResult.customerRows;
  current.larkRows += sumLarkRows(input.larkResults);
  current.sourceWatermark = maxNullable(current.sourceWatermark, input.pageResult.sourceWatermark);
  current.expectedRows = input.pageResult.totalRows;
  datasetCounts[input.contract.dataset] = Object.freeze(current);
  return Object.freeze({
    ...input.state,
    storeContext: input.storeContext,
    datasetCounts: Object.freeze(datasetCounts),
    counts: Object.freeze({
      pages: input.state.counts.pages + 1,
      sourceRows: input.state.counts.sourceRows + input.pageResult.records.length,
      d1Rows: input.state.counts.d1Rows + input.d1Result.totalRows,
      derivedRows: input.state.counts.derivedRows
        + input.derivedResult.salesRows
        + input.derivedResult.productRows
        + input.derivedResult.customerRows,
      larkRows: input.state.counts.larkRows + sumLarkRows(input.larkResults),
      failedRows: input.state.counts.failedRows,
    }),
  });
}

function normalizeState(value, fallbackScope) {
  const source = value && typeof value === 'object' ? value : {};
  const scope = normalizeExecutionScope(source.scope, fallbackScope);
  const datasetCounts = {};
  for (const contract of DATASET_PLAN) {
    datasetCounts[contract.dataset] = Object.freeze({
      ...emptyDatasetCount(),
      ...(source.datasetCounts?.[contract.dataset] ?? {}),
    });
  }
  return Object.freeze({
    scope,
    storeContext: resolveStoreContext(source.storeContext, scope),
    datasetIndex: boundedInteger(source.datasetIndex ?? 0, 'datasetIndex', 0, DATASET_PLAN.length),
    page: boundedInteger(source.page ?? 1, 'page', 1, 1_000_000),
    datasetCounts: Object.freeze(datasetCounts),
    counts: Object.freeze({
      pages: nonNegativeInteger(source.counts?.pages ?? 0, 'pages'),
      sourceRows: nonNegativeInteger(source.counts?.sourceRows ?? 0, 'sourceRows'),
      d1Rows: nonNegativeInteger(source.counts?.d1Rows ?? 0, 'd1Rows'),
      derivedRows: nonNegativeInteger(source.counts?.derivedRows ?? 0, 'derivedRows'),
      larkRows: nonNegativeInteger(source.counts?.larkRows ?? 0, 'larkRows'),
      failedRows: nonNegativeInteger(source.counts?.failedRows ?? 0, 'failedRows'),
    }),
  });
}

function createExecutionScope(runtime) {
  return Object.freeze({
    customerKey: runtime.customerKey,
    accountKey: runtime.accountKey,
    fullReconciliation: runtime.fullReconciliation,
    modifiedAfter: runtime.modifiedAfter,
    incrementalBoundary: runtime.incrementalBoundary,
    orderCreatedAfter: runtime.orderCreatedAfter,
    orderCreatedBefore: runtime.orderCreatedBefore,
    reportingTimezone: runtime.reportingTimezone,
    defaultCurrency: runtime.defaultCurrency,
    pageSize: runtime.pageSize,
    maxNestedPages: runtime.maxNestedPages,
    nestedConcurrency: runtime.nestedConcurrency,
    revisionLookbackMs: runtime.revisionLookbackMs,
  });
}

function normalizeExecutionScope(value, fallback) {
  const source = value && typeof value === 'object' ? value : fallback;
  const orderCreatedAfter = nullableTimestamp(
    source.orderCreatedAfter,
    'scope.orderCreatedAfter',
  );
  const orderCreatedBefore = nullableTimestamp(
    source.orderCreatedBefore,
    'scope.orderCreatedBefore',
  );
  assertOrderHistoryWindow(orderCreatedAfter, orderCreatedBefore);
  return Object.freeze({
    customerKey: requireText(source.customerKey, 'scope.customerKey'),
    accountKey: requireText(source.accountKey, 'scope.accountKey'),
    fullReconciliation: source.fullReconciliation === true,
    modifiedAfter: nullableTimestamp(source.modifiedAfter, 'scope.modifiedAfter'),
    incrementalBoundary: optionalText(source.incrementalBoundary),
    orderCreatedAfter,
    orderCreatedBefore,
    reportingTimezone: requireText(source.reportingTimezone ?? 'Asia/Bangkok', 'scope.reportingTimezone'),
    defaultCurrency: optionalCurrency(source.defaultCurrency),
    pageSize: boundedInteger(source.pageSize ?? 100, 'scope.pageSize', 1, 100),
    maxNestedPages: boundedInteger(source.maxNestedPages ?? 100, 'scope.maxNestedPages', 1, 1_000),
    nestedConcurrency: boundedInteger(
      source.nestedConcurrency ?? DEFAULT_NESTED_CONCURRENCY,
      'scope.nestedConcurrency',
      1,
      10,
    ),
    revisionLookbackMs: boundedInteger(
      source.revisionLookbackMs ?? 30 * 86_400_000,
      'scope.revisionLookbackMs',
      86_400_000,
      365 * 86_400_000,
    ),
  });
}

function resolveStoreContext(value, scope) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.freeze({
    reportingTimezone: requireText(
      source.reportingTimezone ?? source.timezone ?? scope.reportingTimezone,
      'store.reportingTimezone',
    ),
    defaultCurrency: optionalCurrency(
      source.defaultCurrency ?? source.currency ?? scope.defaultCurrency,
    ),
  });
}

function normalizeReference(input) {
  const generation = nonNegativeInteger(input.generation, 'generation');
  const originalRequestedAt = nonNegativeInteger(
    input.originalRequestedAt ?? generation,
    'originalRequestedAt',
  );
  return Object.freeze({
    type: requireText(input.type ?? 'woocommerce.commerce.sync', 'type'),
    schemaVersion: SCHEMA_VERSION,
    workKey: requireText(input.workKey, 'workKey'),
    cursorKey: requireText(input.cursorKey, 'cursorKey'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    generation,
    originalRequestedAt,
  });
}

function normalizeRuntime(input) {
  const now = typeof input.now === 'function' ? input.now : () => Date.now();
  const fullReconciliation = input.fullReconciliation === true;
  const modifiedAfter = nullableTimestamp(input.modifiedAfter, 'modifiedAfter');
  const orderCreatedAfter = nullableTimestamp(
    input.orderCreatedAfter,
    'orderCreatedAfter',
  );
  const orderCreatedBefore = nullableTimestamp(
    input.orderCreatedBefore,
    'orderCreatedBefore',
  );
  assertOrderHistoryWindow(orderCreatedAfter, orderCreatedBefore);
  return Object.freeze({
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    reportingTimezone: requireText(input.reportingTimezone ?? 'Asia/Bangkok', 'reportingTimezone'),
    defaultCurrency: optionalCurrency(input.defaultCurrency),
    connectorEnabled: input.connectorEnabled === true,
    d1WriteEnabled: input.d1WriteEnabled === true,
    larkWriteEnabled: input.larkWriteEnabled === true,
    fullReconciliation,
    modifiedAfter,
    orderCreatedAfter,
    orderCreatedBefore,
    incrementalBoundary: fullReconciliation ? null : createWooCommerceIncrementalBoundary({
      sourceWatermark: modifiedAfter,
      overlapSeconds: input.overlapSeconds ?? 300,
    }),
    pageSize: boundedInteger(input.pageSize ?? 100, 'pageSize', 1, 100),
    maxPagesPerInvocation: boundedInteger(
      input.maxPagesPerInvocation ?? DEFAULT_MAX_PAGES_PER_INVOCATION,
      'maxPagesPerInvocation',
      1,
      20,
    ),
    maxNestedPages: boundedInteger(input.maxNestedPages ?? 100, 'maxNestedPages', 1, 1_000),
    nestedConcurrency: boundedInteger(
      input.nestedConcurrency ?? DEFAULT_NESTED_CONCURRENCY,
      'nestedConcurrency',
      1,
      10,
    ),
    revisionLookbackMs: boundedInteger(
      input.revisionLookbackMs ?? 30 * 86_400_000,
      'revisionLookbackMs',
      86_400_000,
      365 * 86_400_000,
    ),
    now,
  });
}

function readDependencies(input) {
  return Object.freeze({
    client: requireMethods(input.client, [
      'getStoreIdentity', 'listPage', 'listOrderRefunds', 'listProductVariations',
    ], 'client'),
    commerceStore: requireMethods(input.commerceStore, [
      'assertSchemaReady', 'upsertRowsByTable', 'rebuildDerivedFacts', 'readDerivedRows',
    ], 'commerceStore'),
    coverageStore: requireMethods(input.coverageStore, [
      'saveCoverageRun', 'saveCoverageEntities',
    ], 'coverageStore'),
    resumableWorkStore: requireMethods(input.resumableWorkStore, [
      'beginWork', 'loadPhase', 'savePhase', 'completeWork',
    ], 'resumableWorkStore'),
    repository: requireObject(input.repository, 'repository'),
    syncEngine: requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine'),
    tables: requireObject(input.tables, 'tables'),
    continuationQueue: requireMethods(input.continuationQueue, ['send'], 'continuationQueue'),
    assertLockActive: typeof input.assertLockActive === 'function'
      ? input.assertLockActive
      : async () => undefined,
  });
}

function assertExecutionGates(runtime) {
  if (!runtime.connectorEnabled || !runtime.d1WriteEnabled || !runtime.larkWriteEnabled) {
    throw permanentError('WooCommerce Connector, D1 and Lark gates must all be enabled', {
      code: 'WOOCOMMERCE_PROCESSING_GATES_DISABLED',
    });
  }
}

async function queueContinuation(queue, reference) {
  const message = Object.freeze({
    type: reference.type,
    schemaVersion: reference.schemaVersion,
    workKey: reference.workKey,
    cursorKey: reference.cursorKey,
    syncRunId: reference.syncRunId,
    generation: reference.generation,
    originalRequestedAt: reference.originalRequestedAt,
  });
  try {
    await queue.send(message);
  } catch (cause) {
    throw transientError('WooCommerce continuation Queue send failed', {
      code: 'WOOCOMMERCE_CONTINUATION_QUEUE_SEND_FAILED',
      cause,
    });
  }
}

function createReconciliation(reference, state) {
  for (const contract of DATASET_PLAN) {
    const dataset = state.datasetCounts[contract.dataset];
    if (dataset.larkRows < 0 || dataset.d1Rows < 0 || dataset.sourceRows < 0) {
      throw permanentError('WooCommerce reconciliation contains invalid counters', {
        code: 'WOOCOMMERCE_RECONCILIATION_FAILED',
      });
    }
    if (state.scope.fullReconciliation && dataset.expectedRows !== dataset.sourceRows) {
      throw permanentError('WooCommerce full reconciliation is incomplete', {
        code: 'WOOCOMMERCE_RECONCILIATION_FAILED',
        details: { dataset: contract.dataset },
      });
    }
  }
  return Object.freeze({
    schemaVersion: 'woocommerce_commerce_reconciliation_v1',
    workKey: reference.workKey,
    generation: reference.generation,
    scopeMode: state.scope.orderCreatedAfter !== null
      ? 'report_range'
      : state.scope.fullReconciliation ? 'full_inventory' : 'recent_window',
    sourceScope: Object.freeze({
      modifiedAfter: state.scope.modifiedAfter,
      incrementalBoundary: state.scope.incrementalBoundary,
      orderCreatedAfter: state.scope.orderCreatedAfter,
      orderCreatedBefore: state.scope.orderCreatedBefore,
      reportingTimezone: state.storeContext.reportingTimezone,
      defaultCurrency: state.storeContext.defaultCurrency,
    }),
    datasets: state.datasetCounts,
    totals: state.counts,
    failed: state.counts.failedRows,
  });
}

function summarizeProgress(state) {
  return Object.freeze({
    datasetIndex: state.datasetIndex,
    page: state.page,
    scopeMode: state.scope.orderCreatedAfter !== null
      ? 'report_range'
      : state.scope.fullReconciliation ? 'full_inventory' : 'recent_window',
    counts: state.counts,
  });
}

function mergeNormalizedOutputs(left, right) {
  const mergeGroup = (a, b) => Object.freeze(Object.fromEntries(Object.keys(a).map((key) => [
    key,
    Object.freeze([...(a[key] ?? []), ...(b[key] ?? [])]),
  ])));
  const d1RowsByTable = {};
  for (const source of [left.d1RowsByTable, right.d1RowsByTable]) {
    for (const [table, rows] of Object.entries(source)) {
      d1RowsByTable[table] ??= [];
      d1RowsByTable[table].push(...rows);
    }
  }
  return Object.freeze({
    raw: mergeGroup(left.raw, right.raw),
    canonical: mergeGroup(left.canonical, right.canonical),
    daily: mergeGroup(left.daily, right.daily),
    d1RowsByTable: Object.freeze(Object.fromEntries(Object.entries(d1RowsByTable)
      .map(([table, rows]) => [table, Object.freeze(rows)]))),
    impactedDates: Object.freeze([...new Set([...left.impactedDates, ...right.impactedDates])].sort()),
    impactedProducts: Object.freeze([...new Set([...left.impactedProducts, ...right.impactedProducts])].sort()),
    impactedCustomers: Object.freeze([...new Set([...left.impactedCustomers, ...right.impactedCustomers])].sort()),
  });
}

async function mapBounded(values, concurrency, mapper) {
  const source = [...values];
  const results = new Array(source.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, source.length) }, async () => {
    while (next < source.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(source[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function shouldFetchRefunds(order) {
  return (Array.isArray(order?.refunds) && order.refunds.length > 0)
    || Number(order?.total_refunded ?? 0) > 0
    || order?.status === 'refunded';
}

function shouldFetchVariations(product) {
  return product?.type === 'variable'
    || (Array.isArray(product?.variations) && product.variations.length > 0);
}

function readPath(value, path) {
  const rows = path.split('.').reduce((current, key) => current?.[key], value);
  if (!Array.isArray(rows)) throw new TypeError(`WooCommerce Lark path is invalid: ${path}`);
  return rows;
}

function sourceRevision(record) {
  return optionalText(record?.date_modified_gmt ?? record?.date_modified ?? null);
}

function sumLarkRows(results) {
  return results.reduce(
    (total, result) => total + result.created + result.updated + result.skipped,
    0,
  );
}

function emptyDatasetCount() {
  return Object.freeze({
    pages: 0,
    sourceRows: 0,
    expectedRows: 0,
    d1Rows: 0,
    derivedRows: 0,
    larkRows: 0,
    sourceWatermark: null,
  });
}

function maxNullable(left, right) {
  if (left === null || left === undefined) return right ?? null;
  if (right === null || right === undefined) return left;
  return Math.max(Number(left), Number(right));
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return object;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} is required`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function optionalCurrency(value) {
  const text = optionalText(value);
  if (text === null) return null;
  const currency = text.toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new TypeError('currency must be an ISO 4217 code');
  return currency;
}

function positiveInteger(value, fieldName) {
  return boundedInteger(value, fieldName, 1, Number.MAX_SAFE_INTEGER);
}

function nonNegativeInteger(value, fieldName) {
  return boundedInteger(value, fieldName, 0, Number.MAX_SAFE_INTEGER);
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function nullableTimestamp(value, fieldName = 'timestamp') {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) {
    throw new TypeError(`${fieldName} must be an ISO timestamp or epoch milliseconds`);
  }
  return timestamp;
}

function assertOrderHistoryWindow(after, before) {
  if (after !== null && before !== null && after >= before) {
    throw new TypeError('orderCreatedAfter must be earlier than orderCreatedBefore');
  }
}

function utcDate(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

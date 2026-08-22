import {
  META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  META_END_TO_END_LARK_TABLES,
} from '../../../config/src/meta-end-to-end-runtime-config.js';
import { createOrganicHistoryWriter } from '../storage/organic-history-writer.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const PREFLIGHT_PHASE = 'meta_end_to_end_destination_preflight_v1';
const D1_PHASE = 'meta_end_to_end_d1_write_v1';
const LARK_PHASE = 'meta_end_to_end_lark_write_v1';
const COMPLETION_PHASE = 'meta_end_to_end_completion_v1';
const D1_STORE_BATCH_ROWS = 100;
const MAX_PREFLIGHT_DIAGNOSTIC_ISSUES = 100;

/**
 * Durable business processor for an already authenticated/staged Meta generation.
 * Shared Queue retry/lock/DLQ ownership remains with the caller. This function never
 * sends Queue messages, mutates schedules or reads secrets.
 */
export async function processMetaEndToEndGeneration(input = {}) {
  const writeSet = requireWriteSet(input.writeSet);
  const workStore = requireMethods(input.resumableWorkStore, [
    'loadPhase', 'savePhase', 'completeWork',
  ], 'resumableWorkStore');
  const historyStore = requireMethods(input.historyStore, [
    'upsertOrganicAccountDailyFact',
    'upsertAdsEntityState',
    'upsertAdsDailyFact',
    'saveCoverageRun',
    'saveCoverageEntities',
  ], 'historyStore');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tables = requireObject(input.tables, 'tables');
  const workKey = requireText(input.workKey, 'workKey');
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;
  const maxD1Rows = boundedInteger(input.maxD1RowsPerInvocation ?? 250, 'maxD1RowsPerInvocation', 1, 1_000);
  const maxLarkTables = boundedInteger(input.maxLarkTablesPerInvocation ?? 1, 'maxLarkTablesPerInvocation', 1, 4);

  if (input.d1WriteEnabled !== true) {
    throw permanentError('Meta D1 business gate must be enabled', {
      code: 'META_END_TO_END_PROCESSING_GATES_DISABLED',
    });
  }

  const completion = await workStore.loadPhase({ workKey, phase: COMPLETION_PHASE });
  if (completion?.complete) {
    return Object.freeze({
      status: 'completed_idempotent',
      operationId: writeSet.operationId,
      reconciliation: completion.state?.reconciliation ?? null,
    });
  }

  const contracts = activeLarkContracts(writeSet, tables.__metaLarkTableKeys);
  const preflight = input.larkWriteEnabled === true
    ? await ensureDestinationPreflight({
      workStore,
      workKey,
      writeSet,
      contracts,
      repository,
      syncEngine,
      tables,
      assertLockActive,
    })
    : disabledPreflight();

  const d1 = await executeD1Phase({
    workStore,
    workKey,
    writeSet,
    historyStore,
    organicHistoryGateway: input.organicHistoryGateway,
    maxD1Rows,
    assertLockActive,
  });
  if (!d1.complete) {
    return continuation(writeSet, 'd1_continuation', { preflight, d1 });
  }
  if (input.larkWriteEnabled !== true) {
    return continuation(writeSet, 'lark_gate_disabled', { preflight, d1 });
  }

  const lark = await executeLarkPhase({
    workStore,
    workKey,
    writeSet,
    contracts,
    repository,
    syncEngine,
    tables,
    maxLarkTables,
    assertLockActive,
  });
  if (!lark.complete) {
    return continuation(writeSet, 'lark_continuation', { preflight, d1, lark });
  }

  const reconciliation = createReconciliation({ writeSet, preflight, d1, lark });
  await assertLockActive();
  await workStore.savePhase({
    workKey,
    phase: COMPLETION_PHASE,
    state: { reconciliation },
    expectedItems: 1,
    processedItems: 1,
    pagesProcessed: 0,
    chunksProcessed: 1,
    complete: true,
    unit: {
      unitKey: 'completion',
      sequence: 0,
      payload: reconciliation,
    },
  });
  await assertLockActive();
  await workStore.completeWork({ workKey, completion: reconciliation });
  return Object.freeze({
    status: 'completed',
    operationId: writeSet.operationId,
    reconciliation,
  });
}

async function ensureDestinationPreflight(input) {
  const existing = await input.workStore.loadPhase({ workKey: input.workKey, phase: PREFLIGHT_PHASE });
  if (existing?.complete) return normalizePreflight(existing);

  const payloadInspection = await inspectCompleteLarkPayload(input);
  if (payloadInspection.issueCount > 0) {
    throw permanentError('Meta Lark preflight found invalid fields across the complete payload', {
      code: 'LARK_PREFLIGHT_FAILED',
      details: {
        fieldName: payloadInspection.issues[0]?.fieldName ?? null,
        issueCount: payloadInspection.issueCount,
        tablesChecked: payloadInspection.tablesChecked,
        rowsChecked: payloadInspection.rowsChecked,
        fieldsChecked: payloadInspection.fieldsChecked,
        issues: payloadInspection.issues,
        issuesTruncated: payloadInspection.issuesTruncated,
      },
    });
  }

  const summaries = [];
  const planningIssues = [];
  for (const contract of input.contracts) {
    await input.assertLockActive();
    const rows = readPath(input.writeSet, contract.path);
    const tableId = requireText(input.tables[contract.tableKey], `tables.${contract.tableKey}`);
    let plan;
    try {
      plan = await input.syncEngine.planByKey({
        repository: input.repository,
        tableId,
        keyField: contract.keyField,
        rows,
      });
    } catch (error) {
      if (error?.code !== 'LARK_PREFLIGHT_FAILED') throw error;
      addAggregatedPreflightIssue(planningIssues, {
        tableKey: contract.tableKey,
        fieldName: optionalText(error?.details?.fieldName) ?? 'unknown',
        rowIndex: null,
        reasonCode: classifyPreflightReason(error),
        destinationType: null,
        incomingType: 'existing_record',
      });
      continue;
    }
    if (plan.duplicateInputRows !== 0) {
      planningIssues.push(Object.freeze({
        tableKey: contract.tableKey,
        fieldName: contract.keyField,
        rowIndex: null,
        reasonCode: 'DUPLICATE_STABLE_KEY',
        destinationType: null,
        incomingType: 'text',
        affectedRows: plan.duplicateInputRows,
      }));
      continue;
    }
    summaries.push(Object.freeze({
      tableKey: contract.tableKey,
      keyField: contract.keyField,
      expected: rows.length,
      create: plan.createRows.length,
      update: plan.updateRows.length,
      skipped: plan.skipped,
    }));
  }

  if (planningIssues.length > 0) {
    const issues = sortAndLimitIssues(planningIssues);
    throw permanentError('Meta Lark preflight planning failed after complete payload validation', {
      code: 'LARK_PREFLIGHT_FAILED',
      details: {
        fieldName: issues.items[0]?.fieldName ?? null,
        issueCount: planningIssues.length,
        tablesChecked: input.contracts.length,
        rowsChecked: payloadInspection.rowsChecked,
        fieldsChecked: payloadInspection.fieldsChecked,
        issues: issues.items,
        issuesTruncated: issues.truncated,
      },
    });
  }

  const saved = await input.workStore.savePhase({
    workKey: input.workKey,
    phase: PREFLIGHT_PHASE,
    state: {
      summaries,
      diagnostics: {
        tablesChecked: payloadInspection.tablesChecked,
        rowsChecked: payloadInspection.rowsChecked,
        fieldsChecked: payloadInspection.fieldsChecked,
        issueCount: 0,
      },
    },
    expectedItems: input.contracts.length,
    processedItems: input.contracts.length,
    pagesProcessed: 0,
    chunksProcessed: input.contracts.length,
    complete: true,
  });
  return normalizePreflight(saved);
}

async function inspectCompleteLarkPayload(input) {
  if (typeof input.repository?.prepareRows !== 'function'
    || typeof input.repository?.getTableFields !== 'function') {
    return Object.freeze({
      supported: false,
      tablesChecked: 0,
      rowsChecked: 0,
      fieldsChecked: 0,
      issueCount: 0,
      issues: Object.freeze([]),
      issuesTruncated: false,
    });
  }

  const issues = [];
  let rowsChecked = 0;
  let fieldsChecked = 0;

  for (const contract of input.contracts) {
    await input.assertLockActive();
    const rows = readPath(input.writeSet, contract.path);
    const tableId = requireText(input.tables[contract.tableKey], `tables.${contract.tableKey}`);
    const fields = await input.repository.getTableFields(tableId);
    const fieldTypes = new Map(fields.map((field) => [
      requireText(field?.fieldName ?? field?.field_name ?? field?.name, 'field.name'),
      Number.isInteger(Number(field?.type)) ? Number(field.type) : null,
    ]));

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const row = requireObject(rows[rowIndex], `${contract.path}[${rowIndex}]`);
      rowsChecked += 1;
      fieldsChecked += Object.keys(row).length;

      const keyProbe = { [contract.keyField]: row[contract.keyField] };
      const keyValid = await inspectLarkFieldProbe({
        repository: input.repository,
        tableId,
        tableKey: contract.tableKey,
        keyField: contract.keyField,
        fieldName: contract.keyField,
        value: row[contract.keyField],
        rowIndex,
        probe: keyProbe,
        destinationType: fieldTypes.get(contract.keyField) ?? null,
        issues,
      });
      if (!keyValid) continue;

      for (const fieldName of Object.keys(row).sort()) {
        if (fieldName === contract.keyField) continue;
        await inspectLarkFieldProbe({
          repository: input.repository,
          tableId,
          tableKey: contract.tableKey,
          keyField: contract.keyField,
          fieldName,
          value: row[fieldName],
          rowIndex,
          probe: {
            [contract.keyField]: row[contract.keyField],
            [fieldName]: row[fieldName],
          },
          destinationType: fieldTypes.get(fieldName) ?? null,
          issues,
        });
      }
    }
  }

  const limited = sortAndLimitIssues(issues);
  return Object.freeze({
    supported: true,
    tablesChecked: input.contracts.length,
    rowsChecked,
    fieldsChecked,
    issueCount: issues.length,
    issues: limited.items,
    issuesTruncated: limited.truncated,
  });
}

async function inspectLarkFieldProbe(input) {
  try {
    await input.repository.prepareRows(input.tableId, [input.probe], {
      keyField: input.keyField,
    });
    return true;
  } catch (error) {
    if (error?.code !== 'LARK_PREFLIGHT_FAILED') throw error;
    addAggregatedPreflightIssue(input.issues, {
      tableKey: input.tableKey,
      fieldName: optionalText(error?.details?.fieldName) ?? input.fieldName,
      rowIndex: input.rowIndex,
      reasonCode: classifyPreflightReason(error),
      destinationType: input.destinationType,
      incomingType: incomingValueType(input.value),
    });
    return false;
  }
}

function addAggregatedPreflightIssue(issues, issue) {
  const existing = issues.find((candidate) => (
    candidate.tableKey === issue.tableKey
    && candidate.fieldName === issue.fieldName
    && candidate.reasonCode === issue.reasonCode
    && candidate.destinationType === issue.destinationType
    && candidate.incomingType === issue.incomingType
  ));
  if (existing) {
    existing.affectedRows += 1;
    return;
  }
  issues.push({
    ...issue,
    affectedRows: 1,
  });
}

function sortAndLimitIssues(issues) {
  const sorted = [...issues]
    .sort((left, right) => [
      left.tableKey,
      left.fieldName,
      left.reasonCode,
      String(left.destinationType ?? ''),
      left.incomingType,
    ].join(':').localeCompare([
      right.tableKey,
      right.fieldName,
      right.reasonCode,
      String(right.destinationType ?? ''),
      right.incomingType,
    ].join(':')))
    .map((issue) => Object.freeze({ ...issue }));
  return Object.freeze({
    items: Object.freeze(sorted.slice(0, MAX_PREFLIGHT_DIAGNOSTIC_ISSUES)),
    truncated: sorted.length > MAX_PREFLIGHT_DIAGNOSTIC_ISSUES,
  });
}

function classifyPreflightReason(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('field does not exist in destination schema')) return 'FIELD_MISSING';
  if (message.includes('stable key is missing after serialization')) return 'STABLE_KEY_MISSING';
  if (message.includes('not configured in destination select options')) return 'SELECT_OPTION_INVALID';
  if (message.includes('unsupported writable Lark field type')) return 'DESTINATION_TYPE_UNSUPPORTED';
  if (message.includes('date-time') || message.includes('supported range 2000-2100')) {
    return 'DATE_TIME_INVALID';
  }
  if (message.includes('finite number') || message.includes('canonicalized to fixed precision')) {
    return 'NUMBER_INVALID';
  }
  if (message.includes('boolean checkbox')) return 'CHECKBOX_INVALID';
  if (message.includes('absolute http/https URL') || message.includes('non-empty URL')) {
    return 'URL_INVALID';
  }
  if (message.includes('expected an array')) return 'MULTI_SELECT_INVALID';
  if (message.includes('text-compatible value')) return 'TEXT_INVALID';
  return 'SERIALIZATION_INVALID';
}

function incomingValueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (value instanceof Date) return 'date';
  return typeof value;
}

async function executeD1Phase(input) {
  const existing = await input.workStore.loadPhase({ workKey: input.workKey, phase: D1_PHASE });
  const state = normalizeD1State(existing?.state);
  if (existing?.complete) return Object.freeze({ complete: true, state });

  if (!state.organicHistoryDone && input.writeSet.d1.organicHistoryBatch) {
    const gateway = requireMethods(input.organicHistoryGateway, [
      'listOrganicContentStatesByKeys',
      'readCoverageRun',
      'upsertOrganicContentState',
      'saveOrganicContentObservation',
      'saveCoverageRun',
      'saveCoverageEntities',
    ], 'organicHistoryGateway');
    const writer = createOrganicHistoryWriter({ gateway, ...input.writeSet.context });
    const batch = input.writeSet.d1.organicHistoryBatch;
    await input.assertLockActive();
    const plan = await writer.preflightBatch(batch);
    await writer.beginCoverage({
      expectedEntities: plan.contentRows,
      expectedRows: plan.contentRows,
      sourceWatermark: input.writeSet.context.sourceRevision,
    });
    await input.assertLockActive();
    const result = await writer.writeBatch(batch);
    await input.assertLockActive();
    await writer.completeCoverage({
      expectedEntities: plan.contentRows,
      observedEntities: result.contentRows,
      expectedRows: plan.contentRows,
      observedRows: result.contentRows,
      writtenRows: result.stateWritten + result.stateSkipped,
      sourceWatermark: input.writeSet.context.sourceRevision,
      completedAt: input.writeSet.context.observedAt,
    });
    state.organicHistoryDone = true;
    state.organicHistory = result;
    await input.workStore.savePhase({
      workKey: input.workKey,
      phase: D1_PHASE,
      state,
      expectedItems: d1Operations(input.writeSet).length + 1,
      processedItems: state.nextIndex + 1,
      pagesProcessed: 0,
      chunksProcessed: 1,
      complete: false,
      unit: { unitKey: 'organic_history', sequence: 0, payload: result },
    });
  }

  const operations = d1Operations(input.writeSet);
  const start = state.nextIndex;
  const stop = Math.min(operations.length, start + input.maxD1Rows);
  const batch = operations.slice(start, stop);
  if (batch.length > 0) {
    await input.assertLockActive();
    const results = await executeD1Operations(input.historyStore, batch);
    await input.assertLockActive();
    if (!Array.isArray(results) || results.length !== batch.length) {
      throw permanentError('Meta D1 batch result does not match the requested operation count', {
        code: 'META_END_TO_END_D1_BATCH_RECONCILIATION_FAILED',
        details: {
          expectedResults: batch.length,
          observedResults: Array.isArray(results) ? results.length : null,
        },
      });
    }
    for (let index = 0; index < batch.length; index += 1) {
      accumulateD1(state.counts, batch[index].kind, results[index]);
      state.nextIndex += 1;
    }
  }
  const complete = state.nextIndex >= operations.length;
  const saved = await input.workStore.savePhase({
    workKey: input.workKey,
    phase: D1_PHASE,
    state,
    expectedItems: operations.length + (input.writeSet.d1.organicHistoryBatch ? 1 : 0),
    processedItems: state.nextIndex + (state.organicHistoryDone ? 1 : 0),
    pagesProcessed: 0,
    chunksProcessed: Math.ceil(Math.max(1, state.nextIndex) / input.maxD1Rows),
    complete,
    unit: batch.length > 0 ? {
      unitKey: `rows:${start}-${stop}`,
      sequence: stop - 1,
      payload: { nextIndex: state.nextIndex, complete },
    } : undefined,
  });
  return Object.freeze({ complete, state: normalizeD1State(saved?.state ?? state) });
}

async function executeLarkPhase(input) {
  const existing = await input.workStore.loadPhase({ workKey: input.workKey, phase: LARK_PHASE });
  const state = normalizeLarkState(existing?.state);
  if (existing?.complete) return Object.freeze({ complete: true, state });
  const stop = Math.min(input.contracts.length, state.nextTableIndex + input.maxLarkTables);
  while (state.nextTableIndex < stop) {
    const contract = input.contracts[state.nextTableIndex];
    const rows = readPath(input.writeSet, contract.path);
    const tableId = requireText(input.tables[contract.tableKey], `tables.${contract.tableKey}`);
    await input.assertLockActive();
    const plan = await input.syncEngine.planByKey({
      repository: input.repository,
      tableId,
      keyField: contract.keyField,
      rows,
    });
    if (plan.duplicateInputRows !== 0) {
      throw permanentError('Meta Lark execution found duplicate stable keys', {
        code: 'META_END_TO_END_LARK_DUPLICATE',
        details: { tableKey: contract.tableKey },
      });
    }
    const result = await input.syncEngine.executePlan(plan, {
      beforeWriteChunk: input.assertLockActive,
    });
    const accounted = result.created + result.updated + result.skipped;
    if (accounted !== rows.length || result.duplicateInputRows !== 0) {
      throw permanentError('Meta Lark table reconciliation failed', {
        code: 'META_END_TO_END_LARK_RECONCILIATION_FAILED',
        details: { tableKey: contract.tableKey, expected: rows.length, accounted },
      });
    }
    state.results[state.nextTableIndex] = Object.freeze({
      tableKey: contract.tableKey,
      expected: rows.length,
      created: result.created,
      updated: result.updated,
      skipped: result.skipped,
    });
    state.nextTableIndex += 1;
  }
  const complete = state.nextTableIndex >= input.contracts.length;
  const saved = await input.workStore.savePhase({
    workKey: input.workKey,
    phase: LARK_PHASE,
    state,
    expectedItems: input.contracts.length,
    processedItems: state.nextTableIndex,
    pagesProcessed: 0,
    chunksProcessed: state.nextTableIndex,
    complete,
    unit: state.nextTableIndex > 0 ? {
      unitKey: input.contracts[state.nextTableIndex - 1].tableKey,
      sequence: state.nextTableIndex - 1,
      payload: state.results[state.nextTableIndex - 1],
    } : undefined,
  });
  return Object.freeze({ complete, state: normalizeLarkState(saved?.state ?? state) });
}

function d1Operations(writeSet) {
  return Object.freeze([
    ...writeSet.d1.accountDailyFacts.map((row) => Object.freeze({ kind: 'account_daily', row })),
    ...writeSet.d1.adsEntities.map((row) => Object.freeze({ kind: 'ads_entity', row })),
    ...writeSet.d1.adsDailyFacts.map((row) => Object.freeze({ kind: 'ads_daily', row })),
    ...writeSet.d1.coverageRuns.map((row) => Object.freeze({ kind: 'coverage_run', row })),
    ...writeSet.d1.coverageEntities.map((row) => Object.freeze({ kind: 'coverage_entity', row })),
  ]);
}

async function executeD1Operations(store, operations) {
  if (typeof store.writeMetaD1Operations === 'function') {
    const results = [];
    for (let offset = 0; offset < operations.length; offset += D1_STORE_BATCH_ROWS) {
      const batch = operations.slice(offset, offset + D1_STORE_BATCH_ROWS);
      const batchResults = await store.writeMetaD1Operations(batch);
      if (!Array.isArray(batchResults) || batchResults.length !== batch.length) {
        throw permanentError('Meta D1 store batch returned an invalid result count', {
          code: 'META_END_TO_END_D1_BATCH_RECONCILIATION_FAILED',
          details: {
            expectedResults: batch.length,
            observedResults: Array.isArray(batchResults) ? batchResults.length : null,
          },
        });
      }
      results.push(...batchResults);
    }
    return results;
  }
  const results = [];
  for (const operation of operations) {
    results.push(await executeD1Operation(store, operation));
  }
  return results;
}

async function executeD1Operation(store, operation) {
  if (operation.kind === 'account_daily') return store.upsertOrganicAccountDailyFact(operation.row);
  if (operation.kind === 'ads_entity') return store.upsertAdsEntityState(operation.row);
  if (operation.kind === 'ads_daily') return store.upsertAdsDailyFact(operation.row);
  if (operation.kind === 'coverage_run') return store.saveCoverageRun(operation.row);
  if (operation.kind === 'coverage_entity') {
    const results = await store.saveCoverageEntities([operation.row]);
    return results[0];
  }
  throw new TypeError(`Unknown Meta D1 operation: ${operation.kind}`);
}

function createReconciliation({ writeSet, preflight, d1, lark }) {
  const larkResults = lark.state.results;
  for (const result of larkResults) {
    if (!result || result.created + result.updated + result.skipped !== result.expected) {
      throw permanentError('Meta final Lark reconciliation is incomplete', {
        code: 'META_END_TO_END_FINAL_RECONCILIATION_FAILED',
      });
    }
  }
  const expectedD1 = d1Operations(writeSet).length;
  if (d1.state.nextIndex !== expectedD1) {
    throw permanentError('Meta final D1 reconciliation is incomplete', {
      code: 'META_END_TO_END_FINAL_RECONCILIATION_FAILED',
    });
  }
  return deepFreeze({
    schemaVersion: 'meta_end_to_end_reconciliation_v1',
    operationId: writeSet.operationId,
    connectorKey: writeSet.connectorKey,
    source: writeSet.reconciliation,
    preflight: preflight.state.summaries,
    d1: {
      expectedOperations: expectedD1,
      processedOperations: d1.state.nextIndex,
      organicHistory: d1.state.organicHistory,
      counts: d1.state.counts,
    },
    lark: larkResults,
    failed: 0,
  });
}

function activeLarkContracts(writeSet, requestedTableKeys = null) {
  const connectorKey = writeSet.connectorKey;
  const organic = connectorKey === 'facebook' || connectorKey === 'instagram';
  let contracts;
  if (organic) {
    const prefixes = ['canonical.accounts', 'canonical.accountDaily', 'canonical.content'];
    contracts = Object.freeze(META_END_TO_END_LARK_TABLES.filter(
      (contract) => prefixes.some((prefix) => contract.path.startsWith(prefix)),
    ));
  } else {
    const currentPaidAds = connectorKey === 'meta_ads'
      && writeSet.reconciliation?.larkProjectionMode === 'curated_reports';
    const allowedTableKeys = currentPaidAds
      ? null
      : new Set(META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS);
    contracts = Object.freeze(META_END_TO_END_LARK_TABLES.filter((contract) => (
      contract.path.startsWith('canonical.ads')
      && (allowedTableKeys === null || allowedTableKeys.has(contract.tableKey))
    )));
  }
  return scopeLarkContracts(contracts, requestedTableKeys, connectorKey);
}

function scopeLarkContracts(contracts, requestedTableKeys, connectorKey) {
  if (requestedTableKeys === null || requestedTableKeys === undefined) return contracts;
  if (!Array.isArray(requestedTableKeys) || requestedTableKeys.length === 0) {
    throw permanentError('Meta Lark table scope must be a non-empty array when provided', {
      code: 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
      details: { connectorKey },
    });
  }
  const tableKeys = requestedTableKeys.map((value, index) => requireText(
    value,
    `tables.__metaLarkTableKeys[${index}]`,
  ));
  const uniqueKeys = new Set(tableKeys);
  const allowedKeys = new Set(contracts.map((contract) => contract.tableKey));
  const invalidKeys = tableKeys.filter((tableKey) => !allowedKeys.has(tableKey));
  if (uniqueKeys.size !== tableKeys.length || invalidKeys.length > 0) {
    throw permanentError('Meta Lark table scope contains duplicate or unavailable contracts', {
      code: 'META_END_TO_END_LARK_TABLE_SCOPE_INVALID',
      details: {
        connectorKey,
        invalidKeys: Object.freeze([...new Set(invalidKeys)].sort()),
        duplicateTableKeys: uniqueKeys.size !== tableKeys.length,
      },
    });
  }
  return Object.freeze(contracts.filter((contract) => uniqueKeys.has(contract.tableKey)));
}

function disabledPreflight() {
  return Object.freeze({
    complete: false,
    state: Object.freeze({ summaries: Object.freeze([]) }),
    skipped: 'lark_gate_disabled',
  });
}

function normalizePreflight(value) {
  return Object.freeze({
    complete: value?.complete === true,
    state: Object.freeze({
      summaries: Object.freeze(Array.isArray(value?.state?.summaries) ? value.state.summaries : []),
      diagnostics: Object.freeze({
        tablesChecked: nonNegativeInteger(
          value?.state?.diagnostics?.tablesChecked ?? 0,
          'preflight.diagnostics.tablesChecked',
        ),
        rowsChecked: nonNegativeInteger(
          value?.state?.diagnostics?.rowsChecked ?? 0,
          'preflight.diagnostics.rowsChecked',
        ),
        fieldsChecked: nonNegativeInteger(
          value?.state?.diagnostics?.fieldsChecked ?? 0,
          'preflight.diagnostics.fieldsChecked',
        ),
        issueCount: nonNegativeInteger(
          value?.state?.diagnostics?.issueCount ?? 0,
          'preflight.diagnostics.issueCount',
        ),
      }),
    }),
  });
}

function normalizeD1State(value) {
  const source = value && typeof value === 'object' ? value : {};
  const counts = source.counts && typeof source.counts === 'object' ? source.counts : {};
  return {
    organicHistoryDone: source.organicHistoryDone === true,
    organicHistory: source.organicHistory ?? null,
    nextIndex: nonNegativeInteger(source.nextIndex ?? 0, 'd1.nextIndex'),
    counts: {
      written: nonNegativeInteger(counts.written ?? 0, 'd1.counts.written'),
      created: nonNegativeInteger(counts.created ?? 0, 'd1.counts.created'),
      skipped: nonNegativeInteger(counts.skipped ?? 0, 'd1.counts.skipped'),
      account_daily: nonNegativeInteger(counts.account_daily ?? 0, 'd1.counts.account_daily'),
      ads_entity: nonNegativeInteger(counts.ads_entity ?? 0, 'd1.counts.ads_entity'),
      ads_daily: nonNegativeInteger(counts.ads_daily ?? 0, 'd1.counts.ads_daily'),
      coverage_run: nonNegativeInteger(counts.coverage_run ?? 0, 'd1.counts.coverage_run'),
      coverage_entity: nonNegativeInteger(counts.coverage_entity ?? 0, 'd1.counts.coverage_entity'),
    },
  };
}

function normalizeLarkState(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    nextTableIndex: nonNegativeInteger(source.nextTableIndex ?? 0, 'lark.nextTableIndex'),
    results: Array.isArray(source.results) ? [...source.results] : [],
  };
}

function accumulateD1(counts, kind, result) {
  const status = result?.status ?? result?.action ?? result?.disposition ?? 'skipped';
  if (status === 'written') counts.written += 1;
  else if (status === 'created') counts.created += 1;
  else counts.skipped += 1;
  counts[kind] += 1;
}

function continuation(writeSet, status, partial) {
  return Object.freeze({
    status,
    operationId: writeSet.operationId,
    connectorKey: writeSet.connectorKey,
    continuationRequired: true,
    partial,
  });
}

function requireWriteSet(value) {
  const writeSet = requireObject(value, 'writeSet');
  requireText(writeSet.operationId, 'writeSet.operationId');
  requireText(writeSet.connectorKey, 'writeSet.connectorKey');
  requireObject(writeSet.raw, 'writeSet.raw');
  requireObject(writeSet.canonical, 'writeSet.canonical');
  requireObject(writeSet.d1, 'writeSet.d1');
  requireObject(writeSet.context, 'writeSet.context');
  return writeSet;
}

function readPath(value, path) {
  const result = path.split('.').reduce((current, key) => current?.[key], value);
  if (!Array.isArray(result)) throw new TypeError(`Meta write-set path is invalid: ${path}`);
  return result;
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} is required`);
  }
  return object;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
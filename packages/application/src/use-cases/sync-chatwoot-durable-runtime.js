import {
  finalizeChatwootCoverageRuns,
  prepareChatwootAnalyticsSync,
} from './prepare-chatwoot-analytics-sync.js';
import { syncChatwootAnalytics } from './sync-chatwoot-analytics.js';
import {
  assertChatwootDurableState,
  CHATWOOT_CONVERSATION_DISCOVERY_STRATEGIES,
  CHATWOOT_RUNTIME_MODES,
  CHATWOOT_RUNTIME_PHASE,
  createInitialChatwootDurableState,
  isConversationAtOrBeforeChatwootBoundary,
  isChatwootEventInWindow,
  isConversationInChatwootWindow,
  readChatwootContinuationSequence,
  resolveChatwootRuntimeWindow,
} from './chatwoot-runtime-contract.js';
import {
  buildChatwootDailyRollupRows,
  createChatwootDailyRollupState,
  mergeChatwootDailyRollupState,
} from './chatwoot-daily-rollup.js';
import {
  normalizeChatwootAccount,
  normalizeChatwootReportingEvent,
} from '../../../connectors/src/chatwoot/chatwoot-analytics-normalizers.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const ROLLUP_PAGE_SIZE = 500;
const REPORTING_DATASET_KEY = 'chatwoot.reporting_events';
const UPDATED_WITHIN_CLOCK_SKEW_SECONDS = 5 * 60;

/**
 * Execute at most one bounded durable Chatwoot unit per Queue delivery. Durable phase state contains
 * only cursors, counters and compact numeric rollups—never Provider payload, Message content or PII.
 */
export async function syncChatwootDurableRuntime(input = {}) {
  const context = readContext(input);
  let phase = await context.workStore.loadPhase({
    workKey: context.workKey,
    phase: CHATWOOT_RUNTIME_PHASE,
  });
  let state = phase?.state
    ? assertChatwootDurableState(phase.state, {
      mode: context.mode,
      requestedAt: context.requestedAt,
    })
    : createInitialChatwootDurableState({
      mode: context.mode,
      requestedAt: context.requestedAt,
    });

  const requestedSequence = readChatwootContinuationSequence(input.continuationSequence);
  if (requestedSequence > state.nextSequence) {
    throw permanentError('Chatwoot continuation arrived ahead of durable state', {
      code: 'CHATWOOT_CONTINUATION_SEQUENCE_AHEAD',
      details: { requestedSequence, nextSequence: state.nextSequence },
    });
  }
  if (requestedSequence < state.nextSequence) {
    return staleResult(state);
  }
  if (state.complete) return completedResult(state, true);

  await context.assertCurrent();
  if (state.stage === 'masters') {
    state = await processMastersUnit(context, state);
  } else if (state.stage === 'conversations') {
    state = await processConversationUnit(context, state);
  } else if (state.stage === 'reporting') {
    state = await processReportingUnit(context, state);
  } else if (state.stage === 'rollup') {
    state = await processRollupUnit(context, state);
  } else if (state.stage === 'checkpoint') {
    state = await processCheckpointUnit(context, state);
  } else {
    throw permanentError('Chatwoot durable stage is invalid', {
      code: 'CHATWOOT_DURABLE_STATE_INVALID',
      details: { stage: state.stage ?? null },
    });
  }

  await context.assertCurrent();
  phase = await context.workStore.savePhase({
    workKey: context.workKey,
    phase: CHATWOOT_RUNTIME_PHASE,
    state,
    expectedItems: expectedItems(state),
    processedItems: processedItems(state),
    pagesProcessed: state.conversationPagesProcessed + state.reportingPagesProcessed
      + Number(state.rollupPagesProcessed ?? 0),
    chunksProcessed: state.nextSequence,
    complete: state.complete,
  });
  const persisted = assertChatwootDurableState(phase.state, {
    mode: context.mode,
    requestedAt: context.requestedAt,
  });
  return persisted.complete ? completedResult(persisted, false) : continuationResult(persisted);
}

async function processMastersUnit(context, state) {
  const unitSyncRunId = unitRunId(context, state.nextSequence, 'masters');
  const client = createMasterClient(context.client);
  await syncChatwootAnalytics({
    ...baseSyncInput(context, unitSyncRunId),
    fullSnapshot: false,
    reportWriteEnabled: false,
    client,
    incrementalStateStore: deferredCheckpointStore(context.window),
  });
  return freezeState(state, {
    mastersComplete: true,
    stage: 'conversations',
    nextSequence: state.nextSequence + 1,
  });
}

async function processConversationUnit(context, state) {
  const next = { ...state };
  if (next.conversationDiscoveryStrategy
      === CHATWOOT_CONVERSATION_DISCOVERY_STRATEGIES.UPDATED_WITHIN_ONCE
      && next.conversationDiscoveryComplete
      && !next.conversationStateFilterApplied) {
    await refreshRecentlyUpdatedConversationCandidates(context, next);
    next.nextSequence += 1;
    return Object.freeze(next);
  }
  let pagesFetched = 0;
  let rowsProcessed = 0;
  while (pagesFetched < context.limits.conversationPagesPerInvocation
      && rowsProcessed < context.limits.conversationRowsPerInvocation
      && next.stage === 'conversations') {
    if (next.conversationPendingIds.length === 0) {
      if (next.conversationDiscoveryComplete) {
        next.conversationsComplete = true;
        next.stage = 'reporting';
        break;
      }
      if (next.conversationDiscoveryStrategy
          === CHATWOOT_CONVERSATION_DISCOVERY_STRATEGIES.UPDATED_WITHIN_ONCE) {
        await discoverRecentlyUpdatedConversations(context, next);
        pagesFetched += 1;
        if (next.conversationPendingIds.length === 0) continue;
      } else {
        const pageNumber = next.conversationPage;
        await context.assertCurrent();
        const page = await context.client.listConversationsPage({
          page: pageNumber,
          status: 'all',
          assigneeType: 'all',
        });
        pagesFetched += 1;
        const seen = new Set(next.conversationSeenIds);
        const newRows = [];
        for (const row of page.rows) {
          const id = requirePositiveId(row?.id, 'conversation.id');
          if (seen.has(id)) continue;
          seen.add(id);
          newRows.push(row);
        }
        if (seen.size > context.limits.maxConversations) {
          throw permanentError('Chatwoot Conversation identity discovery exceeded configured row limit', {
            code: 'CHATWOOT_ROW_LIMIT_EXCEEDED',
            details: { maxRows: context.limits.maxConversations },
          });
        }
        const boundaryRows = newRows.filter(
          (row) => isConversationAtOrBeforeChatwootBoundary(row, context.window),
        );
        const pending = boundaryRows
          .filter((row) => isConversationInChatwootWindow(row, context.window))
          .map((row) => requirePositiveId(row?.id, 'conversation.id'));
        next.conversationSeenIds = [...seen];
        next.conversationPendingIds = pending;
        next.conversationNewIdsInPass += boundaryRows.length;
        next.conversationRowsScanned += newRows.length;
        next.conversationPagesProcessed += 1;
        next.conversationPage += 1;

        const exhausted = page.rows.length === 0 || page.hasMore === false;
        if (exhausted) {
          if (next.conversationNewIdsInPass === 0) {
            next.conversationDiscoveryComplete = true;
            next.conversationsComplete = true;
            next.stage = 'reporting';
            break;
          }
          next.conversationDiscoveryPass += 1;
          next.conversationPage = 1;
          next.conversationNewIdsInPass = 0;
        }
        if (next.conversationPendingIds.length === 0) continue;
      }
    }

    const ids = next.conversationPendingIds.slice(
      0,
      context.limits.conversationRowsPerInvocation - rowsProcessed,
    );
    await context.assertCurrent();
    const rows = [];
    for (const id of ids) {
      const row = await context.client.getConversation(id);
      if (requirePositiveId(row?.id, 'conversation.id') !== id) {
        throw permanentError('Chatwoot Conversation detail returned a different identity', {
          code: 'CHATWOOT_CONVERSATION_IDENTITY_MISMATCH',
        });
      }
      if (isConversationInChatwootWindow(row, context.window)) rows.push(row);
    }
    if (rows.length > 0) {
      const unitSyncRunId = unitRunId(
        context,
        next.nextSequence,
        `conversations:${next.conversationDiscoveryPass}:${ids[0]}`,
      );
      const client = createConversationPageClient({
        client: context.client,
        rows,
        window: context.window,
      });
      const result = await syncChatwootAnalytics({
        ...baseSyncInput(context, unitSyncRunId),
        fullSnapshot: true,
        reportWriteEnabled: context.flags.reportWrite,
        client,
        incrementalStateStore: deferredCheckpointStore(context.window),
      });
      next.conversationsSelected += result.source.conversationsSelected;
      next.messagesSelected += result.source.messagesSelected;
      next.conversationReportingEventsSelected += result.source.reportingEventsSelected;
      next.conversationRowOffset += rows.length;
    }
    next.conversationPendingIds = next.conversationPendingIds.slice(ids.length);
    rowsProcessed += ids.length;
  }
  next.nextSequence += 1;
  return Object.freeze(next);
}

async function discoverRecentlyUpdatedConversations(context, next) {
  const updatedWithinSeconds = calculateUpdatedWithinSeconds(context);
  await context.assertCurrent();
  const page = await context.client.listConversationsPage({
    page: 1,
    status: 'all',
    assigneeType: 'all',
    updatedWithinSeconds,
  });
  if (page.hasMore !== false) {
    throw permanentError('Chatwoot updated-within query returned a paginated result', {
      code: 'CHATWOOT_PAGE_CONTRACT_INVALID',
      details: { operation: 'list_recently_updated_conversations' },
    });
  }
  const seen = new Set();
  const uniqueRows = [];
  for (const row of page.rows) {
    const id = requirePositiveId(row?.id, 'conversation.id');
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueRows.push(row);
  }
  if (seen.size > context.limits.maxConversations) {
    throw permanentError('Chatwoot recently updated Conversation discovery exceeded configured row limit', {
      code: 'CHATWOOT_ROW_LIMIT_EXCEEDED',
      details: { maxRows: context.limits.maxConversations },
    });
  }
  const boundaryRows = uniqueRows.filter(
    (row) => isConversationAtOrBeforeChatwootBoundary(row, context.window),
  );
  const candidateRows = boundaryRows.filter(
    (row) => isConversationInChatwootWindow(row, context.window),
  );
  const pendingRows = await filterConversationRowsByStoredRevision(context, candidateRows);
  next.conversationSeenIds = [...seen];
  next.conversationPendingIds = pendingRows
    .map((row) => requirePositiveId(row?.id, 'conversation.id'));
  next.conversationsSkippedUnchanged += candidateRows.length - pendingRows.length;
  next.conversationStateFilterApplied = true;
  next.conversationNewIdsInPass = boundaryRows.length;
  next.conversationRowsScanned += uniqueRows.length;
  next.conversationPagesProcessed += 1;
  next.conversationPage = 2;
  next.conversationDiscoveryComplete = true;
  next.conversationUpdatedWithinSeconds = updatedWithinSeconds;
}

async function refreshRecentlyUpdatedConversationCandidates(context, next) {
  const updatedWithinSeconds = calculateUpdatedWithinSeconds(context);
  await context.assertCurrent();
  const page = await context.client.listConversationsPage({
    page: 1,
    status: 'all',
    assigneeType: 'all',
    updatedWithinSeconds,
  });
  if (page.hasMore !== false) {
    throw permanentError('Chatwoot updated-within refresh returned a paginated result', {
      code: 'CHATWOOT_PAGE_CONTRACT_INVALID',
      details: { operation: 'refresh_recently_updated_conversations' },
    });
  }
  const rowsById = new Map();
  for (const row of page.rows) {
    const id = requirePositiveId(row?.id, 'conversation.id');
    if (isConversationAtOrBeforeChatwootBoundary(row, context.window)
        && isConversationInChatwootWindow(row, context.window)) {
      rowsById.set(id, row);
    }
  }
  const pendingRows = next.conversationPendingIds
    .map((id) => rowsById.get(id) ?? null)
    .filter(Boolean);
  const filteredRows = await filterConversationRowsByStoredRevision(context, pendingRows);
  const retained = new Set(
    filteredRows.map((row) => requirePositiveId(row?.id, 'conversation.id')),
  );
  const previousCount = next.conversationPendingIds.length;
  next.conversationPendingIds = next.conversationPendingIds.filter((id) => {
    return !rowsById.has(id) || retained.has(id);
  });
  next.conversationsSkippedUnchanged += previousCount - next.conversationPendingIds.length;
  next.conversationStateFilterApplied = true;
  next.conversationUpdatedWithinSeconds = updatedWithinSeconds;
}

async function filterConversationRowsByStoredRevision(context, rows) {
  if (rows.length === 0) return Object.freeze([]);
  const externalIds = rows.map((row) => requirePositiveId(row?.id, 'conversation.id'));
  const previousStates = [];
  for (let index = 0; index < externalIds.length; index += 100) {
    await context.assertCurrent();
    previousStates.push(...await context.chatwootStore.readConversationStates({
      accountKey: context.accountKey,
      externalIds: externalIds.slice(index, index + 100),
    }));
  }
  const previousById = new Map(
    previousStates.map((row) => [String(row.externalConversationId), row]),
  );
  return Object.freeze(rows.filter((row) => {
    const id = requirePositiveId(row?.id, 'conversation.id');
    const previous = previousById.get(String(id));
    const sourceUpdatedAt = timestamp(row?.updated_at ?? row?.last_activity_at);
    return !previous
      || sourceUpdatedAt === null
      || previous.sourceUpdatedAt === null
      || previous.sourceUpdatedAt < sourceUpdatedAt;
  }));
}

function calculateUpdatedWithinSeconds(context) {
  return Math.ceil(
    (Math.max(context.now(), context.requestedAt) - context.window.startAt) / 1_000,
  ) + UPDATED_WITHIN_CLOCK_SKEW_SECONDS;
}

async function processReportingUnit(context, state) {
  const next = { ...state };
  for (let index = 0; index < context.limits.reportingPagesPerInvocation; index += 1) {
    const pageNumber = next.reportingPage;
    await context.assertCurrent();
    const page = await context.client.listAccountReportingEventsPage({
      page: pageNumber,
      since: context.window.startAt,
      until: context.window.endAt,
    });
    if (next.reportingTotalPages === null && page.totalPages !== null) {
      next.reportingTotalPages = page.totalPages;
    } else if (page.totalPages !== null && next.reportingTotalPages !== page.totalPages) {
      throw permanentError('Chatwoot Reporting totalPages changed during durable work', {
        code: 'CHATWOOT_PAGE_TOTAL_CHANGED',
        details: { previous: next.reportingTotalPages, current: page.totalPages },
      });
    }
    const sourceRows = page.rows.filter((row) => isChatwootEventInWindow(row, context.window));
    if (sourceRows.length > 0) {
      const unitSyncRunId = unitRunId(context, next.nextSequence, `reporting:${pageNumber}`);
      await writeReportingPage(context, sourceRows, unitSyncRunId);
      next.reportingEventsSelected += sourceRows.length;
    }
    next.reportingPagesProcessed += 1;
    next.reportingPage += 1;
    const complete = page.hasMore === false
      || (next.reportingTotalPages !== null && pageNumber >= next.reportingTotalPages)
      || (page.rows.length === 0 && next.reportingTotalPages === null);
    if (complete) {
      next.reportingComplete = true;
      next.stage = context.flags.reportWrite ? 'rollup' : 'checkpoint';
      if (context.flags.reportWrite) initializeRollup(next, context);
      break;
    }
  }
  next.nextSequence += 1;
  return Object.freeze(next);
}

async function processRollupUnit(context, state) {
  const next = structuredClone(state);
  const metricDates = requireStringArray(next.rollupMetricDates, 'rollupMetricDates');
  const metricDate = metricDates[next.rollupDateIndex];
  if (!metricDate) {
    next.rollupComplete = true;
    next.stage = 'checkpoint';
    next.nextSequence += 1;
    return Object.freeze(next);
  }
  const aggregate = next.rollupAggregate
    ?? createChatwootDailyRollupState({
      customerKey: context.customerKey,
      accountKey: context.accountKey,
      externalAccountId: context.externalAccountId,
      metricDate,
    });
  await context.assertCurrent();
  const page = await context.rollupSource.listConversationDailyPage({
    accountKey: context.accountKey,
    metricDate,
    afterKey: next.rollupAfterKey ?? null,
    limit: ROLLUP_PAGE_SIZE,
  });
  next.rollupAggregate = mergeChatwootDailyRollupState(aggregate, page.rows);
  next.rollupPagesProcessed = Number(next.rollupPagesProcessed ?? 0) + 1;
  next.rollupAfterKey = page.nextAfterKey;
  if (page.complete) {
    const unitSyncRunId = unitRunId(context, next.nextSequence, `rollup:${metricDate}`);
    const rows = buildChatwootDailyRollupRows({
      state: next.rollupAggregate,
      reportingTimezone: context.reportingTimezone,
      syncRunId: unitSyncRunId,
      coverageRunIdPrefix: `${unitSyncRunId}:coverage`,
      fetchedAt: context.requestedAt,
    });
    await writeRollupRows(context, rows);
    next.rollupRowsWritten = Number(next.rollupRowsWritten ?? 0)
      + rows.agents.length + rows.inboxes.length + rows.account.length;
    next.rollupDateIndex += 1;
    next.rollupAfterKey = null;
    next.rollupAggregate = null;
    if (next.rollupDateIndex >= metricDates.length) {
      next.rollupComplete = true;
      next.stage = 'checkpoint';
    }
  }
  next.nextSequence += 1;
  return Object.freeze(next);
}

async function processCheckpointUnit(context, state) {
  await context.assertCurrent();
  const previous = await context.incrementalStateStore.loadCheckpoint(context.cursorKey);
  const priorCursor = previous?.cursor ?? null;
  const checkpoint = await context.incrementalStateStore.saveCheckpoint({
    cursor: {
      cursorKey: context.cursorKey,
      customerProfile: context.customerProfile,
      platform: 'chatwoot',
      accountKey: context.accountKey,
      source: 'chatwoot_application_api',
      syncType: context.mode,
      lastMetricDate: context.flags.reportWrite
        ? formatDate(context.window.endAt, context.reportingTimezone)
        : priorCursor?.lastMetricDate ?? null,
      dictionaryHash: null,
      lastFullSyncAt: context.mode === CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT
        ? context.requestedAt
        : priorCursor?.lastFullSyncAt ?? null,
      lastSuccessfulSyncAt: context.requestedAt,
      incrementalRunCount: Number(priorCursor?.incrementalRunCount ?? 0) + 1,
      lastSyncRunId: context.syncRunId,
    },
    records: [],
    fullSnapshot: false,
    generationGuard: {
      cursorKey: context.cursorKey,
      generation: context.generation,
      workKey: context.workKey,
      requestedAt: context.requestedAt,
    },
  });
  return freezeState(state, {
    checkpointComplete: true,
    checkpointResult: sanitizeCheckpointResult(checkpoint),
    complete: true,
    stage: 'complete',
    nextSequence: state.nextSequence + 1,
  });
}

async function writeReportingPage(context, sourceRows, unitSyncRunId) {
  const normalizationContext = Object.freeze({
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    externalAccountId: context.externalAccountId,
    observedAt: context.requestedAt,
  });
  const account = await normalizeChatwootAccount(
    { id: context.externalAccountId },
    normalizationContext,
  );
  const reportingEvents = [];
  for (const row of sourceRows) {
    reportingEvents.push(await normalizeChatwootReportingEvent(row, normalizationContext));
  }
  const prepared = await prepareChatwootAnalyticsSync({
    customerProfile: context.customerProfile,
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    externalAccountId: context.externalAccountId,
    reportingTimezone: context.reportingTimezone,
    syncRunId: unitSyncRunId,
    coverageRunIdPrefix: `${unitSyncRunId}:coverage`,
    observedAt: context.requestedAt,
    fullSnapshot: false,
    includeReports: false,
    account,
    inboxes: [],
    contacts: [],
    agents: [],
    teams: [],
    labels: [],
    conversations: [],
    messages: [],
    reportingEvents,
    previousConversationLabels: [],
  });
  await executeReportingPreparedUnit(context, prepared);
}

/** Reporting pages must never rewrite the latest-state Account with the synthetic normalization row. */
async function executeReportingPreparedUnit(context, prepared) {
  const coverageRuns = prepared.d1.coverageRuns.filter((row) => (
    row.dataset_key === REPORTING_DATASET_KEY && row.observed_rows > 0
  ));
  const runIds = new Set(coverageRuns.map((row) => row.coverage_run_id));
  for (const row of coverageRuns) {
    await context.assertCurrent();
    await context.coverageStore.saveCoverageRun(row);
  }
  for (const row of prepared.d1.reportingEvents) {
    await context.assertCurrent();
    await context.chatwootStore.upsertReportingEventFact(row);
  }
  const entities = prepared.d1.coverageEntities.filter((row) => runIds.has(row.coverage_run_id));
  if (entities.length > 0) {
    await context.assertCurrent();
    await context.coverageStore.saveCoverageEntities(entities);
  }
  const completed = finalizeChatwootCoverageRuns(coverageRuns, context.requestedAt);
  for (const row of completed) {
    await context.assertCurrent();
    await context.coverageStore.saveCoverageRun(row);
  }
}

async function writeRollupRows(context, rows) {
  for (const coverageRun of rows.coverageRuns) {
    await context.assertCurrent();
    await context.coverageStore.saveCoverageRun(coverageRun);
  }
  const specs = [
    [rows.agents, 'upsertAgentDailyFact'],
    [rows.inboxes, 'upsertInboxDailyFact'],
    [rows.account, 'upsertAccountDailyFact'],
  ];
  for (const [values, method] of specs) {
    for (const row of values) {
      await context.assertCurrent();
      await context.chatwootStore[method](row);
    }
  }
  if (context.flags.larkWrite) {
    const targets = [
      ['mktAgentDaily', 'agent_daily_key', rows.agents],
      ['mktInboxDaily', 'inbox_daily_key', rows.inboxes],
      ['mktConversationAccountDaily', 'account_daily_key', rows.account],
    ];
    for (const [tableKey, keyField, values] of targets) {
      if (values.length === 0) continue;
      const plan = await context.syncEngine.planByKey({
        repository: context.repository,
        tableId: requireText(context.tables[tableKey], `tables.${tableKey}`),
        keyField,
        rows: values,
      });
      await context.assertCurrent();
      await context.syncEngine.executePlan(plan, { beforeWriteChunk: context.assertCurrent });
    }
  }
  if (rows.coverageEntities.length > 0) {
    await context.assertCurrent();
    await context.coverageStore.saveCoverageEntities(rows.coverageEntities);
  }
  const completed = finalizeChatwootCoverageRuns(rows.coverageRuns, context.requestedAt);
  for (const coverageRun of completed) {
    await context.assertCurrent();
    await context.coverageStore.saveCoverageRun(coverageRun);
  }
}

function createMasterClient(client) {
  return Object.freeze({
    listInboxes: () => client.listInboxes(),
    listAgents: () => client.listAgents(),
    listTeams: () => client.listTeams(),
    listLabels: () => client.listLabels(),
    listConversationsPage: async () => emptyPage(),
    getConversation: (id) => client.getConversation(id),
    listContactsPage: async () => emptyPage(),
    listConversationReportingEvents: async () => Object.freeze([]),
    listConversationLabels: async () => Object.freeze([]),
    listMessagesPage: async () => emptyMessagePage(),
    collectPages: collectSinglePage,
  });
}

function createConversationPageClient(input) {
  const source = input.client;
  const rows = Object.freeze(input.rows.map((row) => Object.freeze({ ...row })));
  return Object.freeze({
    listInboxes: async () => Object.freeze([]),
    listAgents: async () => Object.freeze([]),
    listTeams: async () => Object.freeze([]),
    listLabels: () => source.listLabels(),
    listConversationsPage: async () => Object.freeze({
      page: 1,
      rows,
      totalCount: rows.length,
      hasMore: false,
    }),
    listContactsPage: async () => emptyPage(),
    listConversationLabels: (id) => source.listConversationLabels(id),
    listConversationReportingEvents: async (id) => Object.freeze(
      (await source.listConversationReportingEvents(id))
        .filter((row) => isChatwootEventInWindow(row, input.window)),
    ),
    listMessagesPage: async (request) => filterMessagePage(
      await source.listMessagesPage(request),
      input.window,
    ),
    collectPages: collectSinglePage,
  });
}

async function collectSinglePage(readPage) {
  const result = await readPage(1);
  return Object.freeze({
    rows: Object.freeze([...result.rows]),
    pagesProcessed: 1,
    declaredTotal: result.totalCount ?? result.rows.length,
    complete: true,
  });
}

function filterMessagePage(page, window) {
  const rows = page.rows.filter((row) => isChatwootEventInWindow(row, window));
  const rawOldest = page.rows.reduce((minimum, row) => {
    const value = timestamp(row?.created_at ?? row?.source_created_at ?? row?.updated_at);
    return value === null ? minimum : Math.min(minimum, value);
  }, Number.POSITIVE_INFINITY);
  const crossedStart = Number.isFinite(rawOldest) && rawOldest < window.startAt;
  return Object.freeze({
    ...page,
    rows: Object.freeze(rows),
    hasMore: page.hasMore === true && !crossedStart && rows.length > 0,
  });
}

function emptyPage() {
  return Object.freeze({ page: 1, rows: Object.freeze([]), totalCount: 0, hasMore: false });
}
function emptyMessagePage() {
  return Object.freeze({
    rows: Object.freeze([]),
    mode: 'before',
    nextAfter: null,
    nextBefore: null,
    hasMore: false,
    labels: Object.freeze([]),
  });
}

function deferredCheckpointStore(window) {
  return Object.freeze({
    loadCheckpoint: async () => Object.freeze({
      cursor: Object.freeze({ lastSuccessfulSyncAt: window.endAt }),
      recordStates: Object.freeze([]),
    }),
    saveCheckpoint: async () => Object.freeze({ saved: false, deferred: true }),
  });
}

function baseSyncInput(context, syncRunId) {
  return {
    customerProfile: context.customerProfile,
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    externalAccountId: context.externalAccountId,
    reportingTimezone: context.reportingTimezone,
    syncRunId,
    coverageRunIdPrefix: `${syncRunId}:coverage`,
    observedAt: context.requestedAt,
    cursorKey: context.cursorKey,
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: context.flags.larkWrite,
    checkpointWriteEnabled: true,
    webhookEnabled: false,
    incrementalOverlapHours: context.window.days * 24,
    maxConversations: context.limits.maxConversations,
    maxContacts: context.limits.maxContacts,
    maxReportingEvents: context.limits.maxReportingEvents,
    maxMessagePagesPerConversation: context.limits.maxMessagePagesPerConversation,
    maxMessagesPerConversation: context.limits.maxMessagesPerConversation,
    chatwootStore: context.chatwootStore,
    coverageStore: context.coverageStore,
    repository: context.repository,
    syncEngine: context.syncEngine,
    tables: context.tables,
    assertLockActive: context.assertCurrent,
  };
}

function readContext(input) {
  const mode = input.mode;
  const requestedAt = positiveInteger(input.requestedAt, 'requestedAt');
  const window = resolveChatwootRuntimeWindow({ mode, requestedAt });
  const workStore = requireMethods(input.workStore, ['loadPhase', 'savePhase'], 'workStore');
  const client = requireMethods(input.client, [
    'listInboxes', 'listAgents', 'listTeams', 'listLabels', 'listConversationsPage',
    'getConversation',
    'listConversationReportingEvents', 'listConversationLabels', 'listMessagesPage',
    'listAccountReportingEventsPage',
  ], 'client');
  const chatwootStore = requireMethods(input.chatwootStore, [
    'upsertAccountState', 'upsertInboxState', 'upsertContactState', 'upsertAgentState',
    'upsertTeamState', 'upsertLabelState', 'upsertConversationState',
    'upsertConversationLabelState', 'upsertMessageAnalyticsState', 'upsertReportingEventFact',
    'upsertConversationDailyFact', 'upsertAgentDailyFact', 'upsertInboxDailyFact',
    'upsertAccountDailyFact', 'readConversationStates', 'readConversationLabelStates',
  ], 'chatwootStore');
  const coverageStore = requireMethods(input.coverageStore, [
    'saveCoverageRun', 'saveCoverageEntities',
  ], 'coverageStore');
  const incrementalStateStore = requireMethods(input.incrementalStateStore, [
    'loadCheckpoint', 'saveCheckpoint',
  ], 'incrementalStateStore');
  const sourceLimits = requireObject(input.limits, 'limits');
  const limits = Object.freeze({
    conversationPagesPerInvocation: positiveInteger(
      sourceLimits.conversationPagesPerInvocation,
      'limits.conversationPagesPerInvocation',
    ),
    conversationRowsPerInvocation: positiveInteger(
      sourceLimits.conversationRowsPerInvocation ?? 1,
      'limits.conversationRowsPerInvocation',
    ),
    reportingPagesPerInvocation: positiveInteger(
      sourceLimits.reportingPagesPerInvocation,
      'limits.reportingPagesPerInvocation',
    ),
    maxConversations: positiveInteger(sourceLimits.maxConversations, 'limits.maxConversations'),
    maxContacts: positiveInteger(sourceLimits.maxContacts, 'limits.maxContacts'),
    maxReportingEvents: positiveInteger(
      sourceLimits.maxReportingEvents,
      'limits.maxReportingEvents',
    ),
    maxMessagePagesPerConversation: positiveInteger(
      sourceLimits.maxMessagePagesPerConversation,
      'limits.maxMessagePagesPerConversation',
    ),
    maxMessagesPerConversation: positiveInteger(
      sourceLimits.maxMessagesPerConversation,
      'limits.maxMessagesPerConversation',
    ),
  });
  const flags = Object.freeze({
    reportWrite: input.flags?.reportWrite === true,
    larkWrite: input.flags?.larkWrite === true,
  });
  const repository = flags.larkWrite ? requireObject(input.repository, 'repository') : null;
  const syncEngine = flags.larkWrite
    ? requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine')
    : null;
  const tables = flags.larkWrite ? requireObject(input.tables, 'tables') : null;
  const rollupSource = flags.reportWrite
    ? requireMethods(input.rollupSource, ['listConversationDailyPage'], 'rollupSource')
    : null;
  return Object.freeze({
    mode,
    requestedAt,
    window,
    workKey: requireText(input.workKey, 'workKey'),
    cursorKey: requireText(input.cursorKey, 'cursorKey'),
    generation: positiveInteger(input.generation, 'generation'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    externalAccountId: positiveInteger(input.externalAccountId, 'externalAccountId'),
    reportingTimezone: requireText(input.reportingTimezone, 'reportingTimezone'),
    limits,
    flags,
    client,
    chatwootStore,
    coverageStore,
    incrementalStateStore,
    rollupSource,
    workStore,
    repository,
    syncEngine,
    tables,
    assertCurrent: typeof input.assertCurrent === 'function'
      ? input.assertCurrent
      : async () => undefined,
    now: typeof input.now === 'function'
      ? () => positiveInteger(input.now(), 'now')
      : () => Date.now(),
  });
}

function initializeRollup(state, context) {
  state.rollupMetricDates = metricDates(context.window, context.reportingTimezone);
  state.rollupDateIndex = 0;
  state.rollupAfterKey = null;
  state.rollupAggregate = null;
  state.rollupPagesProcessed = 0;
  state.rollupRowsWritten = 0;
}

function metricDates(window, timeZone) {
  const values = [];
  let cursor = window.startAt;
  while (cursor <= window.endAt) {
    const value = formatDate(cursor, timeZone);
    if (values.at(-1) !== value) values.push(value);
    cursor += 86_400_000;
  }
  const end = formatDate(window.endAt, timeZone);
  if (values.at(-1) !== end) values.push(end);
  return Object.freeze(values);
}

function formatDate(timestampValue, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestampValue));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function unitRunId(context, sequence, suffix) {
  return `${context.syncRunId}:unit:${sequence}:${suffix}`;
}

function freezeState(state, patch) {
  return Object.freeze({ ...state, ...patch });
}

function continuationResult(state) {
  return Object.freeze({
    status: 'continuation_required',
    complete: false,
    needsContinuation: true,
    nextSequence: state.nextSequence,
    stage: state.stage,
    reconciliation: reconciliation(state),
  });
}

function staleResult(state) {
  return Object.freeze({
    status: state.complete ? 'completed_replay' : 'stale_continuation',
    complete: state.complete,
    needsContinuation: !state.complete,
    nextSequence: state.nextSequence,
    stage: state.stage,
    stale: true,
    reconciliation: reconciliation(state),
  });
}

function completedResult(state, replayed) {
  return Object.freeze({
    status: replayed ? 'completed_replay' : 'completed',
    complete: true,
    needsContinuation: false,
    nextSequence: state.nextSequence,
    stage: 'complete',
    replayed,
    reconciliation: reconciliation(state),
  });
}

function reconciliation(state) {
  return Object.freeze({
    contractVersion: state.contractVersion,
    mode: state.mode,
    windowStartAt: state.windowStartAt,
    windowEndAt: state.windowEndAt,
    automaticBackfillExpansion: false,
    includeUpdatedOlderConversations: true,
    conversationDiscoveryStrategy: state.conversationDiscoveryStrategy,
    conversationDiscoveryComplete: state.conversationDiscoveryComplete,
    conversationUpdatedWithinSeconds: state.conversationUpdatedWithinSeconds,
    conversationStateFilterApplied: state.conversationStateFilterApplied,
    conversationsSkippedUnchanged: state.conversationsSkippedUnchanged,
    conversationPagesProcessed: state.conversationPagesProcessed,
    conversationRowsScanned: state.conversationRowsScanned,
    conversationsSelected: state.conversationsSelected,
    messagesSelected: state.messagesSelected,
    conversationReportingEventsSelected: state.conversationReportingEventsSelected,
    reportingPagesProcessed: state.reportingPagesProcessed,
    reportingTotalPages: state.reportingTotalPages,
    reportingEventsSelected: state.reportingEventsSelected,
    rollupPagesProcessed: Number(state.rollupPagesProcessed ?? 0),
    rollupRowsWritten: Number(state.rollupRowsWritten ?? 0),
    checkpointComplete: state.checkpointComplete,
  });
}

function expectedItems(state) {
  return 1 + Number(state.reportingTotalPages ?? state.reportingPagesProcessed)
    + state.conversationPagesProcessed + Number(state.rollupMetricDates?.length ?? 0) + 1;
}
function processedItems(state) {
  return Number(state.mastersComplete) + state.conversationPagesProcessed
    + state.reportingPagesProcessed + Number(state.rollupDateIndex ?? 0)
    + Number(state.checkpointComplete);
}

function sanitizeCheckpointResult(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    cursorSaved: true,
    recordsSaved: Number(value.recordsSaved ?? 0),
    fullSnapshot: value.fullSnapshot === true,
  });
}

function timestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/u.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number < 100_000_000_000 ? number * 1_000 : number;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function requireStringArray(value, fieldName) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new TypeError(`${fieldName} must be a string array`);
  }
  return value;
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
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

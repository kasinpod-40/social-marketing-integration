import {
  CHATWOOT_LARK_WRITE_TARGETS,
  finalizeChatwootCoverageRuns,
  prepareChatwootAnalyticsSync,
  readChatwootWriteSetPath,
} from './prepare-chatwoot-analytics-sync.js';
import {
  hashChatwootLabelTitle,
  normalizeChatwootAccount,
  normalizeChatwootAgent,
  normalizeChatwootContact,
  normalizeChatwootConversation,
  normalizeChatwootInbox,
  normalizeChatwootLabel,
  normalizeChatwootMessage,
  normalizeChatwootReportingEvent,
  normalizeChatwootTeam,
} from '../../../connectors/src/chatwoot/chatwoot-analytics-normalizers.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_INCREMENTAL_OVERLAP_HOURS = 48;
const DEFAULT_MAX_CONVERSATIONS = 5_000;
const DEFAULT_MAX_CONTACTS = 5_000;
const DEFAULT_MAX_REPORTING_EVENTS = 10_000;
const DEFAULT_MAX_MESSAGE_PAGES_PER_CONVERSATION = 50;
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 1_000;
const STORE_READ_BATCH_SIZE = 500;

const CHATWOOT_STORE_METHODS = Object.freeze([
  'upsertAccountState', 'upsertInboxState', 'upsertContactState', 'upsertAgentState',
  'upsertTeamState', 'upsertLabelState', 'upsertConversationState',
  'upsertConversationLabelState', 'upsertMessageAnalyticsState', 'upsertReportingEventFact',
  'upsertConversationDailyFact', 'upsertAgentDailyFact', 'upsertInboxDailyFact',
  'upsertAccountDailyFact', 'readConversationStates', 'readConversationLabelStates',
]);

/** Execute one bounded Chatwoot polling unit using injected shared runtime contracts. */
export async function syncChatwootAnalytics(input = {}) {
  const gates = assertExecutionGates(input);
  const context = readContext(input, gates);
  const client = requireMethods(input.client, [
    'listInboxes', 'listAgents', 'listTeams', 'listLabels',
    'listConversationsPage', 'listContactsPage', 'listConversationReportingEvents',
    'listConversationLabels', 'listMessagesPage', 'collectPages',
  ], 'client');
  const chatwootStore = requireMethods(input.chatwootStore, CHATWOOT_STORE_METHODS, 'chatwootStore');
  const coverageStore = requireMethods(input.coverageStore, [
    'saveCoverageRun', 'saveCoverageEntities',
  ], 'coverageStore');
  const incrementalStateStore = requireMethods(input.incrementalStateStore, [
    'loadCheckpoint', 'saveCheckpoint',
  ], 'incrementalStateStore');
  const lark = readLarkDependencies(input, gates);
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;

  await assertLockActive();
  const checkpoint = await incrementalStateStore.loadCheckpoint(context.cursorKey);
  const cutoff = context.fullSnapshot
    ? null
    : calculateCutoff(checkpoint?.cursor?.lastSuccessfulSyncAt, context.overlapHours);

  const [sourceInboxes, sourceAgents, sourceTeams, sourceLabels, conversationCollection,
    contactCollection] = await Promise.all([
    client.listInboxes(),
    client.listAgents(),
    client.listTeams(),
    client.listLabels(),
    client.collectPages(
      (page) => client.listConversationsPage({ page, status: 'all', assigneeType: 'all' }),
      { maxRows: context.maxConversations },
    ),
    client.collectPages(
      (page) => client.listContactsPage({ page, sort: '-last_activity_at' }),
      { maxRows: context.maxContacts },
    ),
  ]);

  await assertLockActive();
  const sourceConversations = context.fullSnapshot
    ? conversationCollection.rows
    : filterByCutoff(
      conversationCollection.rows,
      cutoff,
      (row) => readTimestampMs(row?.updated_at ?? row?.last_activity_at),
    );
  const sourceContacts = context.fullSnapshot
    ? contactCollection.rows
    : filterByCutoff(
      contactCollection.rows,
      cutoff,
      (row) => readTimestampMs(row?.updated_at ?? row?.last_activity_at ?? row?.created_at),
    );
  const selectedConversationIds = sourceConversations.map((row) => row.id);
  const [previousStates, previousConversationLabels] = await Promise.all([
    readStoreInBatches(
      chatwootStore.readConversationStates.bind(chatwootStore),
      context.accountKey,
      selectedConversationIds,
    ),
    readStoreInBatches(
      chatwootStore.readConversationLabelStates.bind(chatwootStore),
      context.accountKey,
      selectedConversationIds,
    ),
  ]);
  const previousById = new Map(previousStates.map((row) => [row.externalConversationId, row]));

  const normalizationContext = Object.freeze({
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    externalAccountId: context.externalAccountId,
    observedAt: context.observedAt,
  });
  const account = await normalizeChatwootAccount({ id: context.externalAccountId }, normalizationContext);
  const inboxes = await mapAsync(sourceInboxes, (row) => normalizeChatwootInbox(row, normalizationContext));
  const contacts = await mapAsync(sourceContacts, (row) => normalizeChatwootContact(row, normalizationContext));
  const agents = await mapAsync(sourceAgents, (row) => normalizeChatwootAgent(row, normalizationContext));
  const teams = await mapAsync(sourceTeams, (row) => normalizeChatwootTeam(row, normalizationContext));
  const labels = await mapAsync(sourceLabels, (row) => normalizeChatwootLabel(row, normalizationContext));
  const labelIdsByTitleHash = buildLabelTitleHashIndex(labels);

  const messages = [];
  const reportingEvents = [];
  const conversations = [];
  let unresolvedLabelReferences = 0;
  const conversationBatches = await mapConcurrentOrdered(
    sourceConversations,
    5,
    async (sourceConversation) => {
    await assertLockActive();
    const externalConversationId = requirePositiveId(sourceConversation.id, 'conversation.id');
    const [sourceMessages, sourceConversationEvents] = await Promise.all([
      collectConversationMessages({
        client,
        externalConversationId,
        maxPages: context.maxMessagePagesPerConversation,
        maxRows: context.maxMessagesPerConversation,
      }),
      client.listConversationReportingEvents(externalConversationId),
    ]);
    const normalizedMessages = await mapAsync(sourceMessages, (row) => normalizeChatwootMessage(row, {
      ...normalizationContext,
      externalConversationId,
      externalInboxId: sourceConversation.inbox_id,
    }));
    const normalizedEvents = await mapAsync(
      sourceConversationEvents,
      (row) => normalizeChatwootReportingEvent(row, normalizationContext),
    );
    const labelTitles = await readConversationLabelTitles(client, sourceConversation, externalConversationId);
    const labelIds = [];
    let unresolved = 0;
    for (const title of labelTitles) {
      const titleHash = await hashChatwootLabelTitle(title);
      const id = labelIdsByTitleHash.get(titleHash);
      if (!id) {
        // Deleted labels can remain on historical Conversations without a stable external label ID.
        unresolved += 1;
        continue;
      }
      labelIds.push(id);
    }
    const previous = previousById.get(externalConversationId) ?? null;
    const conversation = await normalizeChatwootConversation(sourceConversation, {
      ...normalizationContext,
      messages: normalizedMessages,
      reportingEvents: normalizedEvents,
      labelIds,
      previousStatus: previous?.status ?? null,
      previousSourceUpdatedAt: previous?.sourceUpdatedAt ?? null,
    });
    return Object.freeze({
      conversation,
      messages: normalizedMessages,
      reportingEvents: normalizedEvents,
      unresolvedLabelReferences: unresolved,
    });
  });
  for (const batch of conversationBatches) {
    conversations.push(batch.conversation);
    messages.push(...batch.messages);
    reportingEvents.push(...batch.reportingEvents);
    unresolvedLabelReferences += batch.unresolvedLabelReferences;
  }
  if (reportingEvents.length > context.maxReportingEvents) {
    throw permanentError('Chatwoot reporting events exceeded configured row limit', {
      code: 'CHATWOOT_REPORTING_EVENT_LIMIT',
      details: { maxRows: context.maxReportingEvents },
    });
  }

  const writeSets = await prepareChatwootAnalyticsSync({
    customerProfile: context.customerProfile,
    customerKey: context.customerKey,
    accountKey: context.accountKey,
    externalAccountId: context.externalAccountId,
    reportingTimezone: context.reportingTimezone,
    syncRunId: context.syncRunId,
    coverageRunIdPrefix: context.coverageRunIdPrefix,
    observedAt: context.observedAt,
    fullSnapshot: context.fullSnapshot,
    includeReports: gates.reportWriteEnabled,
    account,
    inboxes,
    contacts,
    agents,
    teams,
    labels,
    conversations,
    messages,
    reportingEvents,
    previousConversationLabels,
  });

  const larkPlans = gates.larkWriteEnabled
    ? await planLarkWrites({
      larkWriteSet: writeSets.lark,
      repository: lark.repository,
      syncEngine: lark.syncEngine,
      tables: lark.tables,
      reportWriteEnabled: gates.reportWriteEnabled,
    })
    : Object.freeze([]);

  await saveCoverageRuns(writeSets.d1.coverageRuns, coverageStore, assertLockActive);
  await assertLockActive();
  const d1Result = await executeD1Writes({
    writeSet: writeSets.d1,
    chatwootStore,
    assertLockActive,
  });
  const larkResult = gates.larkWriteEnabled
    ? await executeLarkWrites({ plans: larkPlans, syncEngine: lark.syncEngine, assertLockActive })
    : disabledLarkResult();

  await assertLockActive();
  await coverageStore.saveCoverageEntities(writeSets.d1.coverageEntities);
  const finalCoverageRuns = finalizeChatwootCoverageRuns(writeSets.d1.coverageRuns, context.observedAt);
  await saveCoverageRuns(finalCoverageRuns, coverageStore, assertLockActive);

  await assertLockActive();
  const priorCursor = checkpoint?.cursor ?? null;
  const incrementalRunCount = nonNegativeInteger(
    priorCursor?.incrementalRunCount ?? 0,
    'incrementalRunCount',
  ) + 1;
  const checkpointResult = await incrementalStateStore.saveCheckpoint({
    cursor: {
      cursorKey: context.cursorKey,
      customerProfile: context.customerProfile,
      platform: 'chatwoot',
      accountKey: context.accountKey,
      source: 'chatwoot_application_api',
      syncType: context.fullSnapshot ? 'full' : 'incremental',
      lastMetricDate: gates.reportWriteEnabled
        ? writeSets.d1.accountDaily.at(-1)?.metric_date ?? null
        : priorCursor?.lastMetricDate ?? null,
      dictionaryHash: null,
      lastFullSyncAt: context.fullSnapshot ? context.observedAt : priorCursor?.lastFullSyncAt ?? null,
      lastSuccessfulSyncAt: context.observedAt,
      incrementalRunCount,
      lastSyncRunId: context.syncRunId,
    },
    records: writeSets.incremental.sourceRecordStates,
    fullSnapshot: context.fullSnapshot,
    ...(input.generationGuard ? { generationGuard: input.generationGuard } : {}),
  });

  return Object.freeze({
    status: 'completed',
    gates,
    source: Object.freeze({
      conversationPages: conversationCollection.pagesProcessed,
      contactPages: contactCollection.pagesProcessed,
      conversationsScanned: conversationCollection.rows.length,
      conversationsSelected: sourceConversations.length,
      contactsSelected: sourceContacts.length,
      messagesSelected: messages.length,
      reportingEventsSelected: reportingEvents.length,
      unresolvedLabelReferences,
      incrementalCutoff: cutoff,
    }),
    d1: d1Result,
    lark: larkResult,
    coverage: Object.freeze({ status: 'complete', runs: finalCoverageRuns.length }),
    checkpoint: checkpointResult,
    reconciliation: Object.freeze({
      ...writeSets.reconciliation,
      sinksComplete: true,
      labelReferencesComplete: unresolvedLabelReferences === 0,
      unresolvedLabelReferences,
    }),
  });
}

function assertExecutionGates(input) {
  if (input.connectorEnabled !== true) {
    throw permanentError('Chatwoot connector gate must be explicitly enabled', {
      code: 'CHATWOOT_CONNECTOR_DISABLED',
    });
  }
  if (input.d1WriteEnabled !== true || input.checkpointWriteEnabled !== true) {
    throw permanentError('Chatwoot D1 and checkpoint write gates must be explicitly enabled', {
      code: 'CHATWOOT_PROCESSING_GATES_DISABLED',
    });
  }
  if (input.webhookEnabled === true) {
    throw permanentError('Chatwoot webhook is not supported in this workstream', {
      code: 'CHATWOOT_WEBHOOK_NOT_SUPPORTED',
    });
  }
  if (input.reportWriteEnabled === true && input.fullSnapshot !== true) {
    throw permanentError('Chatwoot report writes require an approved full snapshot', {
      code: 'CHATWOOT_REPORT_REQUIRES_FULL_SNAPSHOT',
    });
  }
  return Object.freeze({
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: input.larkWriteEnabled === true,
    reportWriteEnabled: input.reportWriteEnabled === true,
    checkpointWriteEnabled: true,
    webhookEnabled: false,
  });
}

function readLarkDependencies(input, gates) {
  if (!gates.larkWriteEnabled) return Object.freeze({ repository: null, syncEngine: null, tables: null });
  return Object.freeze({
    repository: requireObject(input.repository, 'repository'),
    syncEngine: requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine'),
    tables: requireObject(input.tables, 'tables'),
  });
}

function readContext(input, gates) {
  const accountKey = requireIdentity(input.accountKey, 'accountKey');
  const fullSnapshot = input.fullSnapshot === true;
  return Object.freeze({
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireIdentity(input.customerKey, 'customerKey'),
    accountKey,
    externalAccountId: requirePositiveId(input.externalAccountId, 'externalAccountId'),
    reportingTimezone: requireText(input.reportingTimezone ?? 'UTC', 'reportingTimezone'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    coverageRunIdPrefix: requireText(input.coverageRunIdPrefix ?? input.syncRunId, 'coverageRunIdPrefix'),
    observedAt: positiveInteger(input.observedAt ?? Date.now(), 'observedAt'),
    cursorKey: input.cursorKey ?? `chatwoot:${accountKey}:analytics`,
    fullSnapshot,
    reportWriteEnabled: gates.reportWriteEnabled,
    overlapHours: boundedInteger(
      input.incrementalOverlapHours ?? DEFAULT_INCREMENTAL_OVERLAP_HOURS,
      'incrementalOverlapHours',
      1,
      24 * 30,
    ),
    maxConversations: boundedInteger(
      input.maxConversations ?? DEFAULT_MAX_CONVERSATIONS,
      'maxConversations',
      1,
      50_000,
    ),
    maxContacts: boundedInteger(input.maxContacts ?? DEFAULT_MAX_CONTACTS, 'maxContacts', 1, 50_000),
    maxReportingEvents: boundedInteger(
      input.maxReportingEvents ?? DEFAULT_MAX_REPORTING_EVENTS,
      'maxReportingEvents',
      1,
      100_000,
    ),
    maxMessagePagesPerConversation: boundedInteger(
      input.maxMessagePagesPerConversation ?? DEFAULT_MAX_MESSAGE_PAGES_PER_CONVERSATION,
      'maxMessagePagesPerConversation',
      1,
      1_000,
    ),
    maxMessagesPerConversation: boundedInteger(
      input.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
      'maxMessagesPerConversation',
      1,
      100_000,
    ),
  });
}

async function collectConversationMessages(input) {
  const first = await input.client.listMessagesPage({
    conversationId: input.externalConversationId,
  });
  const rows = [...first.rows];
  const seen = new Set(rows.map((row) => requirePositiveId(row.id, 'message.id')));
  if (rows.length > input.maxRows) throwMessageRowLimit(rows.length, input.maxRows);
  if (!first.hasMore || rows.length === 0) return Object.freeze(rows);

  let before = first.nextBefore;
  if (!before) throwMessageCursorError();
  for (let page = 2; page <= input.maxPages; page += 1) {
    const result = await input.client.listMessagesPage({
      conversationId: input.externalConversationId,
      before,
    });
    for (const row of result.rows) {
      const id = requirePositiveId(row.id, 'message.id');
      if (seen.has(id)) throwMessageCursorError();
      seen.add(id);
    }
    if (rows.length + result.rows.length > input.maxRows) {
      throwMessageRowLimit(rows.length + result.rows.length, input.maxRows);
    }
    rows.unshift(...result.rows);
    if (!result.hasMore || result.rows.length === 0) return Object.freeze(rows);
    if (!result.nextBefore || Number(result.nextBefore) >= Number(before)) throwMessageCursorError();
    before = result.nextBefore;
  }
  throw permanentError('Chatwoot message pagination exceeded configured max pages', {
    code: 'CHATWOOT_MESSAGE_PAGINATION_LIMIT',
    details: { maxPages: input.maxPages },
  });
}

function throwMessageCursorError() {
  throw permanentError('Chatwoot message cursor did not advance', {
    code: 'CHATWOOT_MESSAGE_CURSOR_REPEATED',
  });
}

function throwMessageRowLimit(rows, maxRows) {
  throw permanentError('Chatwoot conversation message volume exceeds configured limit', {
    code: 'CHATWOOT_MESSAGE_ROW_LIMIT',
    details: { rows, maxRows },
  });
}

async function readStoreInBatches(readMethod, accountKey, externalConversationIds) {
  const ids = [...new Set(externalConversationIds.map((value) => requirePositiveId(
    value,
    'externalConversationId',
  )))];
  const result = [];
  for (let index = 0; index < ids.length; index += STORE_READ_BATCH_SIZE) {
    const rows = await readMethod({
      accountKey,
      externalConversationIds: ids.slice(index, index + STORE_READ_BATCH_SIZE),
    });
    result.push(...requireArray(rows, 'store read rows'));
  }
  return Object.freeze(result);
}

async function readConversationLabelTitles(client, conversation, externalConversationId) {
  if (Array.isArray(conversation.labels)) {
    return Object.freeze(conversation.labels.map((value) => requireText(value, 'conversation label')));
  }
  return client.listConversationLabels(externalConversationId);
}

function buildLabelTitleHashIndex(labels) {
  const result = new Map();
  for (const row of labels) {
    if (result.has(row.titleHash) && result.get(row.titleHash) !== row.externalLabelId) {
      throw permanentError('Chatwoot account contains duplicate normalized label titles', {
        code: 'CHATWOOT_LABEL_MAPPING_AMBIGUOUS',
      });
    }
    result.set(row.titleHash, row.externalLabelId);
  }
  return result;
}

async function planLarkWrites(input) {
  const plans = [];
  for (const target of CHATWOOT_LARK_WRITE_TARGETS) {
    if (target.requiresReport && !input.reportWriteEnabled) continue;
    const tableId = requireText(input.tables[target.tableKey], `tables.${target.tableKey}`);
    const rows = readChatwootWriteSetPath(input.larkWriteSet, target.path);
    plans.push(Object.freeze({
      target,
      plan: await input.syncEngine.planByKey({
        repository: input.repository,
        tableId,
        keyField: target.keyField,
        rows,
      }),
    }));
  }
  return Object.freeze(plans);
}

async function executeLarkWrites(input) {
  const tables = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  for (const entry of input.plans) {
    await input.assertLockActive();
    const result = await input.syncEngine.executePlan(entry.plan, {
      beforeWriteChunk: input.assertLockActive,
    });
    created += result.created;
    updated += result.updated;
    skipped += result.skipped;
    tables.push(Object.freeze({ tableKey: entry.target.tableKey, keyField: entry.target.keyField, ...result }));
  }
  return Object.freeze({ enabled: true, created, updated, skipped, tables: Object.freeze(tables) });
}

function disabledLarkResult() {
  return Object.freeze({ enabled: false, created: 0, updated: 0, skipped: 0, tables: Object.freeze([]) });
}

async function executeD1Writes(input) {
  const specifications = [
    ['account', [input.writeSet.account], 'upsertAccountState'],
    ['inboxes', input.writeSet.inboxes, 'upsertInboxState'],
    ['resolvedContacts', input.writeSet.resolvedContacts, 'upsertContactState'],
    ['agents', input.writeSet.agents, 'upsertAgentState'],
    ['teams', input.writeSet.teams, 'upsertTeamState'],
    ['labels', input.writeSet.labels, 'upsertLabelState'],
    ['conversations', input.writeSet.conversations, 'upsertConversationState'],
    ['conversationLabels', input.writeSet.conversationLabels, 'upsertConversationLabelState'],
    ['messages', input.writeSet.messages, 'upsertMessageAnalyticsState'],
    ['reportingEvents', input.writeSet.reportingEvents, 'upsertReportingEventFact'],
    ['conversationDaily', input.writeSet.conversationDaily, 'upsertConversationDailyFact'],
    ['agentDaily', input.writeSet.agentDaily, 'upsertAgentDailyFact'],
    ['inboxDaily', input.writeSet.inboxDaily, 'upsertInboxDailyFact'],
    ['accountDaily', input.writeSet.accountDaily, 'upsertAccountDailyFact'],
  ];
  const datasets = [];
  let written = 0;
  let skipped = 0;
  for (const [dataset, rows, method] of specifications) {
    let datasetWritten = 0;
    let datasetSkipped = 0;
    for (const row of rows) {
      await input.assertLockActive();
      const result = await input.chatwootStore[method](row);
      if (result.outcome === 'written') datasetWritten += 1;
      else datasetSkipped += 1;
    }
    written += datasetWritten;
    skipped += datasetSkipped;
    datasets.push(Object.freeze({ dataset, rows: rows.length, written: datasetWritten, skipped: datasetSkipped }));
  }
  return Object.freeze({ written, skipped, datasets: Object.freeze(datasets) });
}

async function saveCoverageRuns(runs, coverageStore, assertLockActive) {
  for (const row of runs) {
    await assertLockActive();
    await coverageStore.saveCoverageRun(row);
  }
}

function filterByCutoff(rows, cutoff, readTimestamp) {
  if (cutoff === null) return Object.freeze([...rows]);
  return Object.freeze(rows.filter((row) => {
    const timestamp = readTimestamp(row);
    return timestamp === null || timestamp >= cutoff;
  }));
}

function calculateCutoff(lastSuccessfulSyncAt, overlapHours) {
  if (lastSuccessfulSyncAt === null || lastSuccessfulSyncAt === undefined) return null;
  const timestamp = positiveInteger(lastSuccessfulSyncAt, 'lastSuccessfulSyncAt');
  return Math.max(1, timestamp - overlapHours * 60 * 60 * 1_000);
}

function readTimestampMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/u.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number < 100_000_000_000 ? number * 1_000 : number;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function mapAsync(values, mapper) {
  const result = [];
  for (const value of values) result.push(await mapper(value));
  return Object.freeze(result);
}

async function mapConcurrentOrdered(values, concurrency, mapper) {
  if (values.length === 0) return Object.freeze([]);
  const output = new Array(values.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      output[index] = await mapper(values[index], index);
    }
  };
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return Object.freeze(output);
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} must be a function`);
  }
  return object;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireIdentity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return String(number);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

import {
  CHATWOOT_LARK_WRITE_TARGETS,
  prepareChatwootAnalyticsSync,
  readChatwootWriteSetPath,
} from './prepare-chatwoot-analytics-sync.js';
import {
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
const DEFAULT_MAX_MESSAGE_PAGES_PER_CONVERSATION = 10;
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 1_000;

const CHATWOOT_STORE_METHODS = Object.freeze([
  'upsertAccountState', 'upsertInboxState', 'upsertContactState', 'upsertAgentState',
  'upsertTeamState', 'upsertLabelState', 'upsertConversationState',
  'upsertConversationLabelState', 'upsertMessageAnalyticsState', 'upsertReportingEventFact',
  'upsertConversationDailyFact', 'upsertAgentDailyFact', 'upsertInboxDailyFact',
  'upsertAccountDailyFact', 'readConversationStates',
]);

/**
 * Execute one bounded Chatwoot analytics polling unit.
 *
 * The future Worker integration owns Reliability, distributed lock, generation fence,
 * Queue retry/DLQ and durable continuation. This use case performs no Queue operation.
 */
export async function syncChatwootAnalytics(input = {}) {
  assertExecutionGates(input);
  const context = readContext(input);
  const client = requireMethods(input.client, [
    'listInboxes', 'listAgents', 'listTeams', 'listLabels',
    'listConversationsPage', 'listContactsPage', 'listAccountReportingEventsPage',
    'listConversationLabels', 'listMessagesPage', 'collectPages',
  ], 'client');
  const chatwootStore = requireMethods(input.chatwootStore, CHATWOOT_STORE_METHODS, 'chatwootStore');
  const coverageStore = requireMethods(input.coverageStore, [
    'saveCoverageRun', 'saveCoverageEntities',
  ], 'coverageStore');
  const incrementalStateStore = requireMethods(input.incrementalStateStore, [
    'loadCheckpoint', 'saveCheckpoint',
  ], 'incrementalStateStore');
  const repository = requireObject(input.repository, 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tables = requireObject(input.tables, 'tables');
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;

  await assertLockActive();
  const checkpoint = await incrementalStateStore.loadCheckpoint(context.cursorKey);
  const cutoff = calculateCutoff(checkpoint?.cursor?.lastSuccessfulSyncAt, context.overlapHours);

  const [sourceInboxes, sourceAgents, sourceTeams, sourceLabels, conversationCollection,
    contactCollection, reportingEventCollection] = await Promise.all([
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
    client.collectPages(
      (page) => client.listAccountReportingEventsPage({ page }),
      { maxRows: context.maxReportingEvents },
    ),
  ]);

  await assertLockActive();
  const sourceConversations = filterByCutoff(
    conversationCollection.rows,
    cutoff,
    (row) => readTimestampMs(row?.updated_at ?? row?.last_activity_at),
  );
  const sourceContacts = filterByCutoff(
    contactCollection.rows,
    cutoff,
    (row) => readTimestampMs(row?.updated_at ?? row?.last_activity_at ?? row?.created_at),
  );
  const sourceReportingEvents = filterByCutoff(
    reportingEventCollection.rows,
    cutoff,
    (row) => readTimestampMs(row?.updated_at ?? row?.created_at ?? row?.event_end_time),
  );

  const previousStates = await chatwootStore.readConversationStates({
    accountKey: context.accountKey,
    externalConversationIds: sourceConversations.map((row) => row.id),
  });
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
  const labelIdsByTitle = buildLabelTitleIndex(labels);
  const reportingEvents = await mapAsync(
    sourceReportingEvents,
    (row) => normalizeChatwootReportingEvent(row, normalizationContext),
  );
  const eventsByConversation = groupBy(
    reportingEvents.filter((row) => row.externalConversationId),
    (row) => row.externalConversationId,
  );

  const messages = [];
  const conversations = [];
  for (const sourceConversation of sourceConversations) {
    await assertLockActive();
    const externalConversationId = requirePositiveId(sourceConversation.id, 'conversation.id');
    const sourceMessages = await collectConversationMessages({
      client,
      externalConversationId,
      maxPages: context.maxMessagePagesPerConversation,
      maxRows: context.maxMessagesPerConversation,
    });
    const normalizedMessages = await mapAsync(sourceMessages, (row) => normalizeChatwootMessage(row, {
      ...normalizationContext,
      externalConversationId,
      externalInboxId: sourceConversation.inbox_id,
    }));
    messages.push(...normalizedMessages);

    const labelTitles = await readConversationLabelTitles(client, sourceConversation, externalConversationId);
    const labelIds = labelTitles.map((title) => {
      const id = labelIdsByTitle.get(normalizeLabelTitle(title));
      if (!id) {
        throw permanentError('Chatwoot conversation references an unknown label', {
          code: 'CHATWOOT_LABEL_MAPPING_MISSING',
        });
      }
      return id;
    });
    const previous = previousById.get(externalConversationId) ?? null;
    conversations.push(await normalizeChatwootConversation(sourceConversation, {
      ...normalizationContext,
      messages: normalizedMessages,
      reportingEvents: eventsByConversation.get(externalConversationId) ?? [],
      labelIds,
      previousStatus: previous?.status ?? null,
      previousSourceUpdatedAt: previous?.sourceUpdatedAt ?? null,
    }));
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
    account,
    inboxes,
    contacts,
    agents,
    teams,
    labels,
    conversations,
    messages,
    reportingEvents,
  });

  const larkPlans = await planLarkWrites({
    larkWriteSet: writeSets.lark,
    repository,
    syncEngine,
    tables,
  });

  await assertLockActive();
  const d1Result = await executeD1Writes({
    writeSet: writeSets.d1,
    chatwootStore,
    coverageStore,
    assertLockActive,
  });
  const larkResult = await executeLarkWrites({
    plans: larkPlans,
    syncEngine,
    assertLockActive,
  });

  await assertLockActive();
  const priorCursor = checkpoint?.cursor ?? null;
  const incrementalRunCount = nonNegativeInteger(priorCursor?.incrementalRunCount ?? 0, 'incrementalRunCount') + 1;
  const checkpointResult = await incrementalStateStore.saveCheckpoint({
    cursor: {
      cursorKey: context.cursorKey,
      customerProfile: context.customerProfile,
      platform: 'chatwoot',
      accountKey: context.accountKey,
      source: 'chatwoot_application_api',
      syncType: context.fullSnapshot ? 'full' : 'incremental',
      lastMetricDate: writeSets.d1.accountDaily.at(-1)?.metric_date ?? null,
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
    source: Object.freeze({
      conversationPages: conversationCollection.pagesProcessed,
      contactPages: contactCollection.pagesProcessed,
      reportingEventPages: reportingEventCollection.pagesProcessed,
      conversationsScanned: conversationCollection.rows.length,
      conversationsSelected: sourceConversations.length,
      contactsSelected: sourceContacts.length,
      messagesSelected: messages.length,
      reportingEventsSelected: reportingEvents.length,
      incrementalCutoff: cutoff,
    }),
    d1: d1Result,
    lark: larkResult,
    checkpoint: checkpointResult,
    reconciliation: writeSets.reconciliation,
  });
}

function assertExecutionGates(input) {
  if (input.d1WriteEnabled !== true
    || input.larkWriteEnabled !== true
    || input.checkpointWriteEnabled !== true) {
    throw permanentError('Chatwoot D1, Lark and checkpoint write gates must all be explicitly enabled', {
      code: 'CHATWOOT_PROCESSING_GATES_DISABLED',
    });
  }
  if (input.webhookEnabled === true) {
    throw permanentError('Chatwoot webhook is not supported in this workstream', {
      code: 'CHATWOOT_WEBHOOK_NOT_SUPPORTED',
    });
  }
}

function readContext(input) {
  const accountKey = requireIdentity(input.accountKey, 'accountKey');
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
    fullSnapshot: input.fullSnapshot === true,
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
      100,
    ),
    maxMessagesPerConversation: boundedInteger(
      input.maxMessagesPerConversation ?? DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
      'maxMessagesPerConversation',
      1,
      10_000,
    ),
  });
}

async function collectConversationMessages(input) {
  const rows = [];
  let after = null;
  for (let page = 1; page <= input.maxPages; page += 1) {
    const result = await input.client.listMessagesPage({
      conversationId: input.externalConversationId,
      after,
    });
    if (rows.length + result.rows.length > input.maxRows) {
      throw permanentError('Chatwoot conversation message volume exceeds configured limit', {
        code: 'CHATWOOT_MESSAGE_ROW_LIMIT',
        details: { rows: rows.length + result.rows.length, maxRows: input.maxRows },
      });
    }
    rows.push(...result.rows);
    if (!result.hasMore || result.rows.length === 0) return Object.freeze(rows);
    if (!result.nextAfter || result.nextAfter === after) {
      throw permanentError('Chatwoot message cursor did not advance', {
        code: 'CHATWOOT_MESSAGE_CURSOR_REPEATED',
      });
    }
    after = result.nextAfter;
  }
  throw permanentError('Chatwoot message pagination exceeded configured max pages', {
    code: 'CHATWOOT_MESSAGE_PAGINATION_LIMIT',
    details: { maxPages: input.maxPages },
  });
}

async function readConversationLabelTitles(client, conversation, externalConversationId) {
  if (Array.isArray(conversation.labels)) {
    return Object.freeze(conversation.labels.map((value) => requireText(value, 'conversation label')));
  }
  return client.listConversationLabels(externalConversationId);
}

function buildLabelTitleIndex(labels) {
  const result = new Map();
  for (const row of labels) {
    const key = normalizeLabelTitle(row.title);
    if (result.has(key) && result.get(key) !== row.externalLabelId) {
      throw permanentError('Chatwoot account contains duplicate normalized label titles', {
        code: 'CHATWOOT_LABEL_MAPPING_AMBIGUOUS',
      });
    }
    result.set(key, row.externalLabelId);
  }
  return result;
}

function normalizeLabelTitle(value) {
  return requireText(value, 'label title').trim().toLowerCase();
}

async function planLarkWrites(input) {
  const plans = [];
  for (const target of CHATWOOT_LARK_WRITE_TARGETS) {
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
    tables.push(Object.freeze({
      tableKey: entry.target.tableKey,
      keyField: entry.target.keyField,
      ...result,
    }));
  }
  return Object.freeze({ created, updated, skipped, tables: Object.freeze(tables) });
}

async function executeD1Writes(input) {
  const specifications = [
    ['account', [input.writeSet.account], 'upsertAccountState'],
    ['inboxes', input.writeSet.inboxes, 'upsertInboxState'],
    ['contacts', input.writeSet.contacts, 'upsertContactState'],
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

  for (const row of input.writeSet.coverageRuns) {
    await input.assertLockActive();
    await input.coverageStore.saveCoverageRun(row);
  }
  await input.assertLockActive();
  await input.coverageStore.saveCoverageEntities(input.writeSet.coverageEntities);
  return Object.freeze({
    written,
    skipped,
    coverageRuns: input.writeSet.coverageRuns.length,
    coverageEntities: input.writeSet.coverageEntities.length,
    datasets: Object.freeze(datasets),
  });
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

function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

async function mapAsync(values, mapper) {
  const result = [];
  for (const value of values) result.push(await mapper(value));
  return Object.freeze(result);
}

function requireMethods(value, methods, fieldName) {
  const object = requireObject(value, fieldName);
  for (const method of methods) {
    if (typeof object[method] !== 'function') throw new TypeError(`${fieldName}.${method} must be a function`);
  }
  return object;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireIdentity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return String(number);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
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
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} must be a non-empty string`);
  return value.trim();
}

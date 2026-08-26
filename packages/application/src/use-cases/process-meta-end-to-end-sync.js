import { buildMetaAdsWriteSet } from './build-meta-ads-write-set.js';
import { buildMetaOrganicWriteSet } from './build-meta-organic-write-set.js';
import {
  collectMetaEndToEndSourceUnit,
} from './collect-meta-end-to-end-source.js';
import { processMetaEndToEndGeneration } from './process-meta-end-to-end-generation.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
const ORGANIC_CONNECTORS = new Set(['facebook', 'instagram']);
const ADS_CONNECTOR = 'meta_ads';
const META_ADS_MAX_REPORT_RANGE_DAYS = 31;
const SOURCE_UNIT_READ_PAGE_SIZE = 500;
const FACEBOOK_DAILY_CONTENT_SCOPE = 'facebook_daily_dashboard_lookback_v1';
const ORGANIC_STAGES = Object.freeze([
  'account',
  'content',
  'account_insights',
  'content_insights',
  'complete',
]);
const ADS_STAGES = Object.freeze([
  'account',
  'creatives',
  'daily',
  'complete',
]);

/**
 * One bounded Meta provider unit per invocation, staged in the existing resumable-work tables.
 * Business writes reuse the existing D1/Lark processor only after the complete source snapshot
 * is durably available. Queue scheduling and Reliability remain caller-owned.
 */
export async function processMetaEndToEndSync(input = {}) {
  const connectorKey = requireConnector(input.connectorKey);
  const operation = requireOperation(input.operation);
  const workStore = requireMethods(input.resumableWorkStore, [
    'beginWork', 'loadPhase', 'savePhase', 'listPhaseUnits',
  ], 'resumableWorkStore');
  const adapter = requireObject(input.adapter, 'adapter');
  const sourceAccountId = requireText(input.sourceAccountId, 'sourceAccountId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const sourceTimezone = requireText(input.sourceTimezone ?? 'Asia/Bangkok', 'sourceTimezone');
  const dateRange = normalizeDateRange(input.dateRange, connectorKey === ADS_CONNECTOR);
  const limits = normalizeLimits(input.limits);
  const assertLockActive = typeof input.assertLockActive === 'function'
    ? input.assertLockActive
    : async () => undefined;

  const fingerprint = await createStableFingerprint({
    schemaVersion: connectorKey === ADS_CONNECTOR
      ? 'meta_ads_report_range_activity_operation_v1'
      : 'meta_end_to_end_runtime_operation_v1',
    connectorKey,
    sourceAccountId,
    accountKey,
    customerProfile,
    customerKey,
    dateRange,
    generation: operation.generation,
  });
  const begun = await workStore.beginWork({
    workKey: operation.workKey,
    cursorKey: input.cursorKey ?? `meta:${customerProfile}:${connectorKey}:${accountKey}`,
    workType: input.jobType ?? `meta.${connectorKey}.sync`,
    operationFingerprint: fingerprint,
    generation: operation.generation,
    requestedAt: operation.originalRequestedAt,
  });
  if (begun.superseded) {
    return Object.freeze({
      status: 'superseded',
      mode: 'superseded',
      connectorKey,
      operationId: operation.operationId,
      continuationRequired: false,
    });
  }
  if (begun.completed) {
    return Object.freeze({
      status: 'completed_idempotent',
      connectorKey,
      operationId: operation.operationId,
      reconciliation: begun.completion ?? null,
      continuationRequired: false,
    });
  }

  const existing = await workStore.loadPhase({
    workKey: operation.workKey,
    phase: SOURCE_PHASE,
  });
  let state = normalizeSourceState(existing?.state, connectorKey);
  state = prepareFacebookDailyContentResume({ connectorKey, dateRange, state });

  if (state.stage !== 'complete') {
    if (state.unitCount >= limits.sourceMaxUnits) {
      throw limitError(
        'Meta source reached the durable unit limit before completion',
        'META_END_TO_END_SOURCE_UNIT_LIMIT',
        { maximum: limits.sourceMaxUnits },
      );
    }
    await assertLockActive();
    const request = resolveSourceRequest({ connectorKey, state, dateRange });
    const unit = await collectMetaEndToEndSourceUnit({
      connectorKey,
      datasetKey: request.datasetKey,
      adapters: { [connectorKey]: adapter },
      identities: { sourceAccountId },
      state: request.state,
      dateRange: request.dateRange,
      maxPages: limits.sourceMaxPages,
    });
    const payload = createStagedPayload(unit);
    assertUnitSize(payload, limits.sourceMaxUnitBytes);
    state = await advanceState({
      connectorKey,
      state,
      unit,
      payload,
      workStore,
      workKey: operation.workKey,
      limits,
      dateRange,
    });
    await assertLockActive();
    await workStore.savePhase({
      workKey: operation.workKey,
      phase: SOURCE_PHASE,
      state,
      expectedItems: state.stage === 'complete' ? state.unitCount : limits.sourceMaxUnits,
      processedItems: state.unitCount,
      pagesProcessed: state.unitCount,
      chunksProcessed: state.unitCount,
      complete: state.stage === 'complete',
      unit: {
        unitKey: unit.unitKey,
        sequence: state.unitCount - 1,
        payload,
      },
    });

    if (state.stage !== 'complete') {
      return sourceContinuation({ connectorKey, operation, state, unit });
    }
  }

  const staged = await readAllStagedUnits({
    workStore,
    workKey: operation.workKey,
    expectedUnits: state.unitCount,
    maximum: limits.sourceMaxUnits,
    requiredStartSequence: requiredStagedSequenceStart({ connectorKey, state }),
  });
  const sourceSnapshot = assembleSourceSnapshot({
    connectorKey,
    sourceAccountId,
    staged,
    state,
  });

  if (input.sourceReadOnly === true || input.d1WriteEnabled !== true) {
    return Object.freeze({
      status: 'source_validated',
      mode: 'source_read_only',
      connectorKey,
      operationId: operation.operationId,
      continuationRequired: false,
      sourceSummary: summarizeSnapshot(sourceSnapshot),
      sourceWatermark: state.sourceWatermark,
    });
  }

  const writeSet = await buildWriteSet({
    connectorKey,
    sourceSnapshot,
    sourceAccountId,
    accountKey,
    customerProfile,
    customerKey,
    syncRunId,
    operation,
    sourceTimezone,
    sourceWatermark: state.sourceWatermark,
    dateRange,
  });

  const result = await processMetaEndToEndGeneration({
    writeSet,
    resumableWorkStore: workStore,
    historyStore: input.historyStore,
    organicHistoryGateway: input.organicHistoryGateway,
    repository: input.repository ?? {},
    syncEngine: input.syncEngine ?? noLarkSyncEngine(),
    tables: input.tables ?? {},
    workKey: operation.workKey,
    d1WriteEnabled: true,
    larkWriteEnabled: input.larkWriteEnabled === true,
    maxD1RowsPerInvocation: limits.d1RowsPerInvocation,
    maxPreflightRowsPerInvocation: limits.preflightRowsPerInvocation,
    maxLarkRowsPerInvocation: limits.larkRowsPerInvocation,
    maxLarkTablesPerInvocation: limits.larkTablesPerInvocation,
    assertLockActive,
  });
  return Object.freeze({
    ...result,
    connectorKey,
    operationId: operation.operationId,
    sourceSummary: summarizeSnapshot(sourceSnapshot),
    sourceWatermark: state.sourceWatermark,
  });
}

async function advanceState(input) {
  const next = cloneState(input.state);
  next.unitCount += 1;
  next.rowCount += input.unit.rowCount;
  next.sourceWatermark = maxText(next.sourceWatermark, input.unit.sourceWatermark);
  if (next.unitCount > input.limits.sourceMaxUnits) {
    throw limitError('Meta source exceeded the durable unit limit', 'META_END_TO_END_SOURCE_UNIT_LIMIT', {
      maximum: input.limits.sourceMaxUnits,
    });
  }
  if (next.rowCount > input.limits.sourceMaxRows) {
    throw limitError('Meta source exceeded the staged row limit', 'META_END_TO_END_SOURCE_ROW_LIMIT', {
      maximum: input.limits.sourceMaxRows,
    });
  }
  if (input.unit.nextState) {
    next.pageState = input.unit.nextState;
    return freezeState(next);
  }

  next.pageState = null;
  if (ORGANIC_CONNECTORS.has(input.connectorKey)) {
    if (next.stage === 'account') {
      next.stage = 'content';
      if (isFacebookDailyRange(input.connectorKey, input.dateRange)) {
        next.contentInventoryScope = FACEBOOK_DAILY_CONTENT_SCOPE;
        next.contentInventoryStartSequence = next.unitCount;
      }
    } else if (next.stage === 'content') {
      const staged = await readAllStagedUnits({
        workStore: input.workStore,
        workKey: input.workKey,
        expectedUnits: input.state.unitCount,
        maximum: input.limits.sourceMaxUnits,
        requiredStartSequence: requiredStagedSequenceStart({
          connectorKey: input.connectorKey,
          state: input.state,
        }),
      });
      const currentPayload = stagedPayloadWithSequence(input.payload, input.state.unitCount);
      const contentIds = uniqueText(
        scopedOrganicEntries({
          staged: [...staged, currentPayload],
          connectorKey: input.connectorKey,
          state: input.state,
          datasetKey: `${input.connectorKey}.content.inventory`,
        })
          .flatMap((entry) => entry.rows)
          .map((row) => row?.id),
      );
      next.contentIds = contentIds;
      next.contentIndex = 0;
      next.stage = 'account_insights';
    } else if (next.stage === 'account_insights') {
      next.stage = next.contentIds.length > 0 ? 'content_insights' : 'complete';
      next.pageState = next.contentIds.length > 0
        ? { entityId: next.contentIds[0], pageNumber: 1 }
        : null;
    } else if (next.stage === 'content_insights') {
      next.contentIndex += 1;
      if (next.contentIndex >= next.contentIds.length) {
        next.stage = 'complete';
      } else {
        next.pageState = { entityId: next.contentIds[next.contentIndex], pageNumber: 1 };
      }
    }
  } else {
    const index = ADS_STAGES.indexOf(next.stage);
    next.stage = ADS_STAGES[index + 1] ?? 'complete';
  }
  return freezeState(next);
}

function prepareFacebookDailyContentResume({ connectorKey, dateRange, state }) {
  if (!isFacebookDailyRange(connectorKey, dateRange)) return state;
  if (state.contentInventoryScope === FACEBOOK_DAILY_CONTENT_SCOPE) return state;
  if (!['content', 'account_insights', 'content_insights'].includes(state.stage)) return state;
  return freezeState({
    ...cloneState(state),
    stage: 'content',
    pageState: null,
    contentIds: [],
    contentIndex: 0,
    sourceWatermark: null,
    contentInventoryScope: FACEBOOK_DAILY_CONTENT_SCOPE,
    contentInventoryStartSequence: state.unitCount,
  });
}

function isFacebookDailyRange(connectorKey, dateRange) {
  return connectorKey === 'facebook'
    && dateRange?.since
    && dateRange.since === dateRange.until;
}

function resolveSourceRequest({ connectorKey, state, dateRange }) {
  const pageState = state.pageState ?? { pageNumber: 1 };
  if (ORGANIC_CONNECTORS.has(connectorKey)) {
    if (state.stage === 'account') {
      return { datasetKey: `${connectorKey}.account.latest`, state: pageState };
    }
    if (state.stage === 'content') {
      return {
        datasetKey: `${connectorKey}.content.inventory`,
        state: pageState,
        dateRange,
      };
    }
    if (state.stage === 'account_insights') {
      return {
        datasetKey: `${connectorKey}.account.insights`,
        state: pageState,
        dateRange,
      };
    }
    if (state.stage === 'content_insights') {
      return {
        datasetKey: `${connectorKey}.content.insights`,
        state: {
          ...pageState,
          entityId: state.contentIds[state.contentIndex],
        },
        dateRange,
      };
    }
  }
  const adsDatasets = {
    account: 'meta_ads.account.latest',
    creatives: 'meta_ads.creatives.inventory',
    daily: 'meta_ads.performance.daily',
  };
  return {
    datasetKey: adsDatasets[state.stage],
    state: pageState,
    ...(state.stage === 'daily' ? { dateRange } : {}),
  };
}

function assembleSourceSnapshot({ connectorKey, sourceAccountId, staged, state }) {
  const rowsFor = (datasetKey) => scopedOrganicEntries({
    staged,
    connectorKey,
    state,
    datasetKey,
  }).flatMap((entry) => entry.rows);
  if (ORGANIC_CONNECTORS.has(connectorKey)) {
    const account = rowsFor(`${connectorKey}.account.latest`);
    if (account.length !== 1) {
      throw permanentError('Meta Organic account source must contain exactly one resource', {
        code: 'META_END_TO_END_SOURCE_ACCOUNT_INVALID',
      });
    }
    const insightMap = new Map();
    for (const entry of scopedOrganicEntries({
      staged,
      connectorKey,
      state,
      datasetKey: `${connectorKey}.content.insights`,
    })) {
      const id = requireText(entry.sourceEntityId, 'sourceEntityId');
      insightMap.set(id, [...(insightMap.get(id) ?? []), ...entry.rows]);
    }
    return deepFreeze({
      connectorKey,
      sourceAccountId,
      accountResource: account[0],
      contentResources: rowsFor(`${connectorKey}.content.inventory`),
      accountInsights: rowsFor(`${connectorKey}.account.insights`),
      contentInsights: [...insightMap.entries()].map(([contentId, insights]) => ({
        contentId,
        insights,
      })),
      sourceWatermark: state.sourceWatermark,
    });
  }
  const account = staged
    .filter((entry) => entry.datasetKey === 'meta_ads.account.latest')
    .flatMap((entry) => entry.rows);
  if (account.length !== 1) {
    throw permanentError('Meta Ads account source must contain exactly one resource', {
      code: 'META_END_TO_END_SOURCE_ACCOUNT_INVALID',
    });
  }
  const hasCreativeInventoryUnit = staged.some(
    (entry) => entry.datasetKey === 'meta_ads.creatives.inventory',
  );
  const creatives = staged
    .filter((entry) => entry.datasetKey === 'meta_ads.creatives.inventory')
    .flatMap((entry) => entry.rows);
  const dailyInsights = staged
    .filter((entry) => entry.datasetKey === 'meta_ads.performance.daily')
    .flatMap((entry) => entry.rows);
  const activity = deriveMetaAdsActivityEntities(dailyInsights);
  return deepFreeze({
    connectorKey,
    sourceAccountId,
    accountResource: account[0],
    campaigns: activity.campaigns,
    adSets: activity.adSets,
    ads: activity.ads,
    creatives,
    dailyInsights,
    entityScopeMode: 'report_range',
    larkProjectionMode: hasCreativeInventoryUnit ? 'curated_reports' : 'detailed',
    sourceWatermark: state.sourceWatermark,
  });
}

function scopedOrganicEntries({ staged, connectorKey, state, datasetKey }) {
  const matching = staged.filter((entry) => entry.datasetKey === datasetKey);
  if (connectorKey !== 'facebook'
    || state.contentInventoryScope !== FACEBOOK_DAILY_CONTENT_SCOPE
    || datasetKey === 'facebook.account.latest') {
    return matching;
  }
  const startSequence = state.contentInventoryStartSequence;
  if (!Number.isSafeInteger(startSequence) || startSequence < 0) {
    throw permanentError('Facebook daily content scope is missing its durable sequence marker', {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
    });
  }
  return matching.filter((entry) => entry.sequence >= startSequence);
}

function requiredStagedSequenceStart({ connectorKey, state }) {
  if (connectorKey !== 'facebook'
    || state.contentInventoryScope !== FACEBOOK_DAILY_CONTENT_SCOPE) {
    return 0;
  }
  const startSequence = state.contentInventoryStartSequence;
  if (!Number.isSafeInteger(startSequence)
    || startSequence < 0
    || startSequence > state.unitCount) {
    throw permanentError('Facebook daily content scope has an invalid required sequence marker', {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
      details: { connectorKey, startSequence, unitCount: state.unitCount },
    });
  }
  return startSequence;
}

async function buildWriteSet(input) {
  const common = {
    accountId: input.sourceAccountId,
    accountKey: input.accountKey,
    customerKey: input.customerKey,
    syncRunId: input.syncRunId,
    operationId: input.operation.operationId,
    fetchedAt: input.operation.originalRequestedAt,
    completedAt: input.operation.originalRequestedAt,
    sourceRevision: input.sourceWatermark ?? input.operation.operationId,
    sourceWatermark: input.sourceWatermark,
  };
  if (ORGANIC_CONNECTORS.has(input.connectorKey)) {
    return buildMetaOrganicWriteSet({
      ...common,
      connectorKey: input.connectorKey,
      customerProfile: input.customerProfile,
      sourceTimezone: input.sourceTimezone,
      accountResource: input.sourceSnapshot.accountResource,
      contentResources: input.sourceSnapshot.contentResources,
      contentInsights: input.sourceSnapshot.contentInsights,
      accountInsights: input.sourceSnapshot.accountInsights,
      observationDate: input.dateRange.until,
      contentScopeMode: input.dateRange.since ? 'report_range' : 'full_inventory',
    });
  }
  const accountTimezone = requireText(
    input.sourceSnapshot.accountResource?.timezone_name,
    'Meta Ads account timezone_name',
  );
  const currency = requireText(
    input.sourceSnapshot.accountResource?.currency,
    'Meta Ads account currency',
  );
  return buildMetaAdsWriteSet({
    ...common,
    accountTimezone,
    currency,
    accountResource: input.sourceSnapshot.accountResource,
    campaigns: input.sourceSnapshot.campaigns,
    adSets: input.sourceSnapshot.adSets,
    ads: input.sourceSnapshot.ads,
    creatives: input.sourceSnapshot.creatives,
    dailyInsights: input.sourceSnapshot.dailyInsights,
    entityScopeMode: input.sourceSnapshot.entityScopeMode,
    larkProjectionMode: input.sourceSnapshot.larkProjectionMode,
    periodStart: input.dateRange.since,
    periodEnd: input.dateRange.until,
  });
}

function deriveMetaAdsActivityEntities(rows) {
  const campaigns = new Map();
  const adSets = new Map();
  const ads = new Map();
  const ordered = requireArray(rows, 'Meta Ads activity insights')
    .map((row) => requireObject(row, 'Meta Ads activity insight'))
    .sort((left, right) => activityRowSortKey(left).localeCompare(activityRowSortKey(right)));

  for (const row of ordered) {
    const campaignId = requireText(row.campaign_id, 'Meta Ads activity campaign_id');
    const adSetId = requireText(row.adset_id, 'Meta Ads activity adset_id');
    const adId = requireText(row.ad_id, 'Meta Ads activity ad_id');
    const metricDate = requireDate(row.date_start, 'Meta Ads activity date_start');
    upsertActivityEntity(campaigns, campaignId, {
      id: campaignId,
      name: optionalText(row.campaign_name),
      objective: optionalText(row.objective),
      metricDate,
    }, []);
    upsertActivityEntity(adSets, adSetId, {
      id: adSetId,
      campaign_id: campaignId,
      name: optionalText(row.adset_name),
      metricDate,
    }, ['campaign_id']);
    upsertActivityEntity(ads, adId, {
      id: adId,
      campaign_id: campaignId,
      adset_id: adSetId,
      name: optionalText(row.ad_name),
      metricDate,
    }, ['campaign_id', 'adset_id']);
  }

  return deepFreeze({
    campaigns: activityValues(campaigns),
    adSets: activityValues(adSets),
    ads: activityValues(ads),
  });
}

function upsertActivityEntity(target, id, candidate, parentFields) {
  const existing = target.get(id);
  if (existing) {
    for (const field of parentFields) {
      if (existing[field] !== candidate[field]) {
        throw permanentError('Meta Ads activity hierarchy changed inside one report range', {
          code: 'META_ADS_ACTIVITY_IDENTITY_DRIFT',
          details: { entityId: id, field },
        });
      }
    }
  }
  if (!existing || candidate.metricDate >= existing.metricDate) target.set(id, candidate);
}

function activityValues(values) {
  return Object.freeze([...values.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ metricDate: _metricDate, ...value }) => Object.freeze(value)));
}

function activityRowSortKey(row) {
  return [
    optionalText(row.date_start) ?? '',
    optionalText(row.campaign_id) ?? '',
    optionalText(row.adset_id) ?? '',
    optionalText(row.ad_id) ?? '',
    optionalText(row.publisher_platform) ?? '',
    optionalText(row.campaign_name) ?? '',
    optionalText(row.adset_name) ?? '',
    optionalText(row.ad_name) ?? '',
  ].join(':');
}

async function readAllStagedUnits({
  workStore,
  workKey,
  expectedUnits,
  maximum,
  requiredStartSequence = 0,
}) {
  if (expectedUnits === 0) return Object.freeze([]);
  if (expectedUnits > maximum) {
    throw limitError('Meta staged unit count exceeds the read limit', 'META_END_TO_END_SOURCE_UNIT_LIMIT', {
      maximum,
    });
  }
  if (!Number.isSafeInteger(requiredStartSequence)
    || requiredStartSequence < 0
    || requiredStartSequence > expectedUnits) {
    throw permanentError('Meta durable source staging required sequence range is invalid', {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
      details: { expectedUnits, requiredStartSequence },
    });
  }
  const units = [];
  let afterSequence = 0;
  while (units.length < expectedUnits) {
    const result = await workStore.listPhaseUnits({
      workKey,
      phase: SOURCE_PHASE,
      afterSequence,
      limit: Math.min(SOURCE_UNIT_READ_PAGE_SIZE, expectedUnits - units.length),
    });
    units.push(...result.units);
    if (units.length >= expectedUnits || result.nextSequence === null) break;
    if (!Number.isSafeInteger(result.nextSequence) || result.nextSequence <= afterSequence) {
      throw permanentError('Meta durable source staging pagination did not advance', {
        code: 'META_END_TO_END_SOURCE_STAGING_INCOMPLETE',
        details: { expectedUnits, observedUnits: units.length, requiredStartSequence },
      });
    }
    afterSequence = result.nextSequence;
  }

  const observedSequences = new Set();
  for (const unit of units) {
    const sequence = nonNegativeInteger(unit.sequence, 'staged unit sequence');
    if (sequence >= expectedUnits || observedSequences.has(sequence)) {
      throw permanentError('Meta durable source staging sequence set is invalid', {
        code: 'META_END_TO_END_SOURCE_STAGING_INCOMPLETE',
        details: { expectedUnits, observedUnits: units.length, requiredStartSequence, sequence },
      });
    }
    observedSequences.add(sequence);
  }

  const missingRequiredSequences = [];
  for (let sequence = requiredStartSequence; sequence < expectedUnits; sequence += 1) {
    if (!observedSequences.has(sequence)) missingRequiredSequences.push(sequence);
  }

  if (missingRequiredSequences.length > 0
    || (requiredStartSequence === 0 && units.length !== expectedUnits)) {
    throw permanentError('Meta durable source staging is incomplete', {
      code: 'META_END_TO_END_SOURCE_STAGING_INCOMPLETE',
      details: {
        expectedUnits,
        observedUnits: units.length,
        requiredStartSequence,
        missingRequiredSequences: missingRequiredSequences.slice(0, 20),
      },
    });
  }
  return Object.freeze(units.map((unit) => normalizeStagedPayload(unit.payload, unit.sequence)));
}

function createStagedPayload(unit) {
  return deepFreeze({
    schemaVersion: 'meta_end_to_end_staged_source_unit_v1',
    datasetKey: unit.datasetKey,
    sourceEntityId: unit.sourceEntityId,
    sourceStatus: unit.sourceStatus,
    sourceWatermark: unit.sourceWatermark,
    pageNumber: unit.pageNumber,
    rows: unit.rows,
  });
}

function stagedPayloadWithSequence(payload, sequence) {
  return deepFreeze({
    ...payload,
    sequence: nonNegativeInteger(sequence, 'staged payload sequence'),
  });
}

function normalizeStagedPayload(value, sequence) {
  const payload = requireObject(value, 'staged payload');
  return deepFreeze({
    schemaVersion: requireText(payload.schemaVersion, 'staged payload schemaVersion'),
    datasetKey: requireText(payload.datasetKey, 'staged payload datasetKey'),
    sourceEntityId: optionalText(payload.sourceEntityId),
    sourceStatus: requireText(payload.sourceStatus, 'staged payload sourceStatus'),
    sourceWatermark: optionalText(payload.sourceWatermark),
    pageNumber: nonNegativeInteger(payload.pageNumber, 'staged payload pageNumber'),
    sequence: nonNegativeInteger(sequence, 'staged payload sequence'),
    rows: requireArray(payload.rows, 'staged payload rows'),
  });
}

function sourceContinuation({ connectorKey, operation, state, unit }) {
  return Object.freeze({
    status: 'source_continuation',
    connectorKey,
    operationId: operation.operationId,
    continuationRequired: true,
    continuationPhase: state.stage,
    stagedUnits: state.unitCount,
    stagedRows: state.rowCount,
    sourceStatus: unit.sourceStatus,
    sourceWatermark: state.sourceWatermark,
  });
}

function summarizeSnapshot(snapshot) {
  if (ORGANIC_CONNECTORS.has(snapshot.connectorKey)) {
    return Object.freeze({
      accountRows: 1,
      contentRows: snapshot.contentResources.length,
      contentInsightEntities: snapshot.contentInsights.length,
      contentInsightRows: snapshot.contentInsights.reduce((sum, entry) => sum + entry.insights.length, 0),
      accountInsightRows: snapshot.accountInsights.length,
    });
  }
  return Object.freeze({
    accountRows: 1,
    campaignRows: snapshot.campaigns.length,
    adSetRows: snapshot.adSets.length,
    adRows: snapshot.ads.length,
    creativeRows: snapshot.creatives.length,
    dailyRows: snapshot.dailyInsights.length,
  });
}

function normalizeSourceState(value, connectorKey) {
  const source = value && typeof value === 'object' ? value : {};
  const allowedStages = ORGANIC_CONNECTORS.has(connectorKey) ? ORGANIC_STAGES : ADS_STAGES;
  const stage = source.stage ?? 'account';
  if (!allowedStages.includes(stage)) {
    throw permanentError('Meta durable source stage is invalid', {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
      details: { connectorKey, stage },
    });
  }
  const contentInventoryScope = optionalText(source.contentInventoryScope);
  const contentInventoryStartSequence = optionalNonNegativeInteger(
    source.contentInventoryStartSequence,
    'contentInventoryStartSequence',
  );
  if (contentInventoryScope !== null
    && contentInventoryScope !== FACEBOOK_DAILY_CONTENT_SCOPE) {
    throw permanentError('Meta durable Content inventory scope is invalid', {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
      details: { connectorKey, contentInventoryScope },
    });
  }
  if ((contentInventoryScope === FACEBOOK_DAILY_CONTENT_SCOPE)
    !== (contentInventoryStartSequence !== null)) {
    throw permanentError('Meta durable Content inventory scope marker is incomplete', {
      code: 'META_END_TO_END_SOURCE_STATE_INVALID',
      details: { connectorKey },
    });
  }
  return freezeState({
    stage,
    pageState: normalizePageState(source.pageState),
    contentIds: uniqueText(source.contentIds ?? []),
    contentIndex: nonNegativeInteger(source.contentIndex ?? 0, 'contentIndex'),
    unitCount: nonNegativeInteger(source.unitCount ?? 0, 'unitCount'),
    rowCount: nonNegativeInteger(source.rowCount ?? 0, 'rowCount'),
    sourceWatermark: optionalText(source.sourceWatermark),
    contentInventoryScope,
    contentInventoryStartSequence,
  });
}

function normalizePageState(value) {
  if (value === null || value === undefined) return null;
  const source = requireObject(value, 'pageState');
  return Object.freeze({
    after: optionalText(source.after),
    visitedCursors: uniqueText(source.visitedCursors ?? []),
    pageNumber: nonNegativeInteger(source.pageNumber ?? 1, 'pageState.pageNumber'),
    sourceWatermark: optionalText(source.sourceWatermark),
    entityId: optionalText(source.entityId),
  });
}

function normalizeLimits(value) {
  const source = requireObject(value ?? {}, 'limits');
  return Object.freeze({
    sourceMaxPages: boundedInteger(source.sourceMaxPages ?? 100, 'sourceMaxPages', 1, 2_500),
    sourceMaxUnits: boundedInteger(source.sourceMaxUnits ?? 500, 'sourceMaxUnits', 1, 2_500),
    sourceMaxRows: boundedInteger(source.sourceMaxRows ?? 50_000, 'sourceMaxRows', 1, 50_000),
    sourceMaxUnitBytes: boundedInteger(
      source.sourceMaxUnitBytes ?? 524_288,
      'sourceMaxUnitBytes',
      1_024,
      1_048_576,
    ),
    d1RowsPerInvocation: boundedInteger(
      source.d1RowsPerInvocation ?? 250,
      'd1RowsPerInvocation',
      1,
      1_000,
    ),
    preflightRowsPerInvocation: boundedInteger(
      source.preflightRowsPerInvocation ?? 100,
      'preflightRowsPerInvocation',
      1,
      1_000,
    ),
    larkRowsPerInvocation: boundedInteger(
      source.larkRowsPerInvocation ?? 100,
      'larkRowsPerInvocation',
      1,
      1_000,
    ),
    larkTablesPerInvocation: boundedInteger(
      source.larkTablesPerInvocation ?? 1,
      'larkTablesPerInvocation',
      1,
      4,
    ),
  });
}

function normalizeDateRange(value, required) {
  if (!value) {
    if (!required) return Object.freeze({});
    throw permanentError('Meta Ads manual sync requires a bounded date range', {
      code: 'META_END_TO_END_DATE_RANGE_REQUIRED',
    });
  }
  const source = requireObject(value, 'dateRange');
  const since = requireDate(source.since, 'dateRange.since');
  const until = requireDate(source.until, 'dateRange.until');
  if (since > until) throw new TypeError('dateRange.since cannot be after dateRange.until');
  if (required && inclusiveDateCount(since, until) > META_ADS_MAX_REPORT_RANGE_DAYS) {
    throw permanentError('Meta Ads report range exceeds the approved latest-month boundary', {
      code: 'META_ADS_REPORT_RANGE_TOO_LARGE',
      details: { maximumDays: META_ADS_MAX_REPORT_RANGE_DAYS },
    });
  }
  return Object.freeze({ since, until });
}

function inclusiveDateCount(since, until) {
  return Math.floor(
    (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000,
  ) + 1;
}

function requireOperation(value) {
  const operation = requireObject(value, 'operation');
  if (operation.stable !== true) {
    throw permanentError('Meta runtime requires a stable Queue operation', {
      code: 'META_END_TO_END_QUEUE_OPERATION_REQUIRED',
    });
  }
  return Object.freeze({
    operationId: requireText(operation.operationId, 'operation.operationId'),
    workKey: requireText(operation.workKey, 'operation.workKey'),
    generation: requireTimestamp(operation.generation, 'operation.generation'),
    originalRequestedAt: requireTimestamp(
      operation.originalRequestedAt,
      'operation.originalRequestedAt',
    ),
  });
}

function requireConnector(value) {
  const connectorKey = requireText(value, 'connectorKey');
  if (![...ORGANIC_CONNECTORS, ADS_CONNECTOR].includes(connectorKey)) {
    throw new TypeError(`Unsupported Meta connector: ${connectorKey}`);
  }
  return connectorKey;
}

function assertUnitSize(payload, maximum) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  if (bytes > maximum) {
    throw limitError('Meta source unit exceeds the durable payload byte limit', 'META_END_TO_END_SOURCE_UNIT_TOO_LARGE', {
      maximum,
      observed: bytes,
    });
  }
}

function noLarkSyncEngine() {
  return Object.freeze({
    planByKey() {
      throw permanentError('Meta Lark sync engine is unavailable while Lark gate is disabled', {
        code: 'META_END_TO_END_LARK_GATE_DISABLED',
      });
    },
    executePlan() {
      throw permanentError('Meta Lark sync engine is unavailable while Lark gate is disabled', {
        code: 'META_END_TO_END_LARK_GATE_DISABLED',
      });
    },
  });
}

function cloneState(value) {
  return {
    stage: value.stage,
    pageState: value.pageState ? { ...value.pageState } : null,
    contentIds: [...value.contentIds],
    contentIndex: value.contentIndex,
    unitCount: value.unitCount,
    rowCount: value.rowCount,
    sourceWatermark: value.sourceWatermark,
    contentInventoryScope: value.contentInventoryScope,
    contentInventoryStartSequence: value.contentInventoryStartSequence,
  };
}

function freezeState(value) {
  return deepFreeze({
    ...value,
    contentIds: [...value.contentIds],
  });
}

function uniqueText(values) {
  if (!Array.isArray(values)) throw new TypeError('Expected an array of text values');
  return Object.freeze([...new Set(values
    .map((value) => optionalText(value))
    .filter(Boolean))]);
}

function maxText(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return left > right ? left : right;
}

function limitError(message, code, details) {
  return permanentError(message, { code, details });
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

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}

function optionalNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return nonNegativeInteger(value, fieldName);
}

function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

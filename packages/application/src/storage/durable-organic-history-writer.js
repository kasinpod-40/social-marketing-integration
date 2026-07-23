import { createOrganicHistoryWriter } from './organic-history-writer.js';
import {
  createObservationKey,
  validateStorageRow,
} from './marketing-history-contract.js';

/**
 * Durable ordering wrapper:
 * 1) repair/insert deterministic Observation,
 * 2) upsert current State,
 * 3) insert Coverage entity.
 *
 * The repair path is required for the 2026-07-23 incident where 309 initial State rows became
 * durable before the old writer reached Observation writes. It never fabricates a new timestamp.
 */
export function createDurableOrganicHistoryWriter(input = {}) {
  const base = createOrganicHistoryWriter(input);
  const gateway = requireGateway(input.gateway);

  const preflightBatch = async (batch) => augmentPlan({
    plan: await base.preflightBatch(batch),
    context: base.context,
    gateway,
  });

  return Object.freeze({
    context: base.context,
    preflightBatch,
    beginCoverage: base.beginCoverage,
    completeCoverage: base.completeCoverage,
    failCoverage: base.failCoverage,
    async writeBatch(batch) {
      const plan = await preflightBatch(batch);
      const result = {
        contentRows: plan.contentRows,
        stateWritten: 0,
        stateSkipped: 0,
        observationsCreated: 0,
        observationsSkipped: 0,
        observationsNotRequired: plan.contentRows - plan.observationRows.length,
        coverageEntitiesWritten: 0,
        coverageEntitiesSkipped: 0,
      };

      // Observation-first prevents a future mid-unit stop from replacing the only information
      // needed to classify changed/correction observations before that observation is durable.
      for (const row of plan.observationRows) {
        const write = await gateway.saveOrganicContentObservation(row);
        if (write.status === 'created') result.observationsCreated += 1;
        else result.observationsSkipped += 1;
      }
      for (const row of plan.stateRows) {
        const write = await gateway.upsertOrganicContentState(row);
        if (write.status === 'written') result.stateWritten += 1;
        else result.stateSkipped += 1;
      }
      const coverageWrites = await gateway.saveCoverageEntities(plan.coverageEntities);
      for (const write of coverageWrites) {
        if (write.status === 'written') result.coverageEntitiesWritten += 1;
        else result.coverageEntitiesSkipped += 1;
      }

      return Object.freeze({ ...result, classifications: plan.classifications });
    },
  });
}

async function augmentPlan({ plan, context, gateway }) {
  const contentKeys = plan.stateRows.map((row) => row.content_key);
  const observedKeys = new Set(await gateway.listObservedContentKeysAt(
    contentKeys,
    context.observedAt,
  ));
  const plannedByContent = new Map(plan.observationRows.map((row) => [row.content_key, row]));
  const repaired = [];

  for (const state of plan.stateRows) {
    if (plannedByContent.has(state.content_key) || observedKeys.has(state.content_key)) continue;
    if (Number(state.created_at) !== context.observedAt) continue;
    const row = createInitialObservationFromState(context, state);
    plannedByContent.set(state.content_key, row);
    repaired.push(state.content_key);
  }

  const classifications = plan.classifications.map((classification) => (
    repaired.includes(classification.contentKey)
      ? Object.freeze({
        ...classification,
        observationKind: 'initial',
        repairedMissingObservation: true,
      })
      : classification
  ));

  return Object.freeze({
    ...plan,
    observationRows: Object.freeze([...plannedByContent.values()]),
    classifications: Object.freeze(classifications),
    repairedMissingObservations: repaired.length,
  });
}

function createInitialObservationFromState(context, state) {
  return validateStorageRow('organic_content_observations', {
    observation_key: createObservationKey({
      content_key: state.content_key,
      observed_at: context.observedAt,
      observation_kind: 'initial',
    }),
    content_key: state.content_key,
    customer_key: context.customerKey,
    platform: context.platform,
    account_key: context.accountKey,
    external_content_id: state.external_content_id,
    observed_at: context.observedAt,
    metric_date: context.metricDate,
    source_timezone: context.sourceTimezone,
    observation_kind: 'initial',
    metric_semantics: 'cumulative',
    views: state.views,
    likes: state.likes,
    comments: state.comments,
    shares: state.shares,
    unique_viewers: state.unique_viewers,
    avg_watch_time_seconds: state.avg_watch_time_seconds,
    total_watch_time_seconds: state.total_watch_time_seconds,
    completion_rate: state.completion_rate,
    metrics_hash: state.metrics_hash,
    source_revision: context.sourceRevision,
    coverage_run_id: context.coverageRunId,
    fetched_at: context.fetchedAt,
    sync_run_id: context.historySyncRunId,
    created_at: context.observedAt,
  });
}

function requireGateway(value) {
  for (const method of [
    'listObservedContentKeysAt',
    'saveOrganicContentObservation',
    'upsertOrganicContentState',
    'saveCoverageEntities',
  ]) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Durable Organic history writer requires gateway.${method}`);
    }
  }
  return value;
}

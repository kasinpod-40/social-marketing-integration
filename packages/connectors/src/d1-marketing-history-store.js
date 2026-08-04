import {
  validateStorageRow,
} from '../../application/src/storage/marketing-history-contract.js';
import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

const MAX_OBSERVATION_QUERY_ROWS = 1_000;
const MAX_FACT_QUERY_ROWS = 5_000;
const MAX_REPORT_QUERY_ROWS = 500;
const MAX_META_D1_BATCH_ROWS = 100;

/**
 * D1 repository สำหรับ Storage Foundation v1
 *
 * Phase 1B สร้าง Repository และ Tests เท่านั้น ยังไม่มี Runtime route เรียกใช้ Store นี้
 * Store ไม่มี Delete/Retention method โดยตั้งใจ เพื่อรักษา additive/rollback-safe boundary
 */
export class D1MarketingHistoryStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async upsertOrganicContentState(value) {
    const row = validateStorageRow('organic_content_state', value);
    return this.#runWrite('organic_content_state', row.content_key, `
      INSERT INTO organic_content_state (
        content_key, customer_profile, customer_key, platform, account_key,
        source_account_id, external_content_id, content_type, published_at,
        first_seen_at, last_observed_at, last_changed_at, source_availability_status,
        views, likes, comments, shares, unique_viewers,
        avg_watch_time_seconds, total_watch_time_seconds, completion_rate,
        metrics_hash, metadata_hash, last_coverage_run_id, last_sync_run_id,
        created_at, updated_at
      ) VALUES (${placeholders(27)})
      ON CONFLICT(content_key) DO UPDATE SET
        customer_profile = excluded.customer_profile,
        customer_key = excluded.customer_key,
        source_account_id = COALESCE(excluded.source_account_id, organic_content_state.source_account_id),
        content_type = COALESCE(excluded.content_type, organic_content_state.content_type),
        published_at = COALESCE(excluded.published_at, organic_content_state.published_at),
        first_seen_at = MIN(organic_content_state.first_seen_at, excluded.first_seen_at),
        last_observed_at = MAX(organic_content_state.last_observed_at, excluded.last_observed_at),
        last_changed_at = CASE
          WHEN organic_content_state.metrics_hash <> excluded.metrics_hash
            OR organic_content_state.metadata_hash <> excluded.metadata_hash
          THEN COALESCE(excluded.last_changed_at, excluded.last_observed_at)
          ELSE organic_content_state.last_changed_at
        END,
        source_availability_status = excluded.source_availability_status,
        views = COALESCE(excluded.views, organic_content_state.views),
        likes = COALESCE(excluded.likes, organic_content_state.likes),
        comments = COALESCE(excluded.comments, organic_content_state.comments),
        shares = COALESCE(excluded.shares, organic_content_state.shares),
        unique_viewers = COALESCE(excluded.unique_viewers, organic_content_state.unique_viewers),
        avg_watch_time_seconds = COALESCE(excluded.avg_watch_time_seconds, organic_content_state.avg_watch_time_seconds),
        total_watch_time_seconds = COALESCE(excluded.total_watch_time_seconds, organic_content_state.total_watch_time_seconds),
        completion_rate = COALESCE(excluded.completion_rate, organic_content_state.completion_rate),
        metrics_hash = excluded.metrics_hash,
        metadata_hash = excluded.metadata_hash,
        last_coverage_run_id = excluded.last_coverage_run_id,
        last_sync_run_id = excluded.last_sync_run_id,
        updated_at = excluded.updated_at
      WHERE excluded.platform = organic_content_state.platform
        AND excluded.account_key = organic_content_state.account_key
        AND excluded.external_content_id = organic_content_state.external_content_id
        AND excluded.last_observed_at >= organic_content_state.last_observed_at
    `, bindColumns(row, [
      'content_key', 'customer_profile', 'customer_key', 'platform', 'account_key',
      'source_account_id', 'external_content_id', 'content_type', 'published_at',
      'first_seen_at', 'last_observed_at', 'last_changed_at', 'source_availability_status',
      'views', 'likes', 'comments', 'shares', 'unique_viewers',
      'avg_watch_time_seconds', 'total_watch_time_seconds', 'completion_rate',
      'metrics_hash', 'metadata_hash', 'last_coverage_run_id', 'last_sync_run_id',
      'created_at', 'updated_at',
    ]));
  }

  async saveOrganicContentObservation(value) {
    const row = validateStorageRow('organic_content_observations', value);
    let result;
    try {
      result = await this.db.prepare(`
        INSERT INTO organic_content_observations (
          observation_key, content_key, customer_key, platform, account_key,
          external_content_id, observed_at, metric_date, source_timezone,
          observation_kind, metric_semantics, views, likes, comments, shares,
          unique_viewers, avg_watch_time_seconds, total_watch_time_seconds,
          completion_rate, metrics_hash, source_revision, coverage_run_id,
          fetched_at, sync_run_id, created_at
        ) VALUES (${placeholders(25)})
        ON CONFLICT(observation_key) DO NOTHING
      `).bind(...bindColumns(row, [
        'observation_key', 'content_key', 'customer_key', 'platform', 'account_key',
        'external_content_id', 'observed_at', 'metric_date', 'source_timezone',
        'observation_kind', 'metric_semantics', 'views', 'likes', 'comments', 'shares',
        'unique_viewers', 'avg_watch_time_seconds', 'total_watch_time_seconds',
        'completion_rate', 'metrics_hash', 'source_revision', 'coverage_run_id',
        'fetched_at', 'sync_run_id', 'created_at',
      ])).run();
    } catch (cause) {
      throw d1WriteError('organic_content_observations', cause);
    }

    if (readChanges(result) > 0) {
      return freezeWrite('created', 'organic_content_observations', row.observation_key, 1);
    }

    const existing = await this.#first(`
      SELECT * FROM organic_content_observations WHERE observation_key = ?
    `, [row.observation_key], 'D1_ORGANIC_OBSERVATION_READ_FAILED');
    if (!existing) throw d1WriteError('organic_content_observations', new Error('conflict row not found'));
    assertObservationRetryMatches(existing, row);
    return freezeWrite('skipped', 'organic_content_observations', row.observation_key, 0);
  }

  async upsertOrganicAccountDailyFact(value) {
    const row = validateStorageRow('organic_account_daily_facts', value);
    const columns = [
      'account_daily_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
      'metric_date', 'account_timezone', 'followers', 'follows', 'profile_views', 'views',
      'reach', 'accounts_engaged', 'total_interactions', 'net_follows', 'data_status',
      'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
    ];
    return this.#genericUpsert({
      table: 'organic_account_daily_facts', keyField: 'account_daily_key', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['source_revision', 'data_status', 'fetched_at'],
    });
  }

  async upsertAdsEntityState(value) {
    const row = validateStorageRow('ads_entity_state', value);
    return this.#runWrite('ads_entity_state', row.entity_key, `
      INSERT INTO ads_entity_state (
        entity_key, customer_key, platform, account_key, source_account_id,
        entity_type, external_entity_id, parent_campaign_id, parent_ad_group_id,
        parent_ad_id, external_creative_id, entity_name, status, objective, currency,
        timezone, source_updated_at, first_seen_at, last_seen_at,
        source_availability_status, metadata_hash, last_coverage_run_id,
        last_sync_run_id, created_at, updated_at
      ) VALUES (${placeholders(25)})
      ON CONFLICT(entity_key) DO UPDATE SET
        customer_key = excluded.customer_key,
        source_account_id = excluded.source_account_id,
        parent_campaign_id = COALESCE(excluded.parent_campaign_id, ads_entity_state.parent_campaign_id),
        parent_ad_group_id = COALESCE(excluded.parent_ad_group_id, ads_entity_state.parent_ad_group_id),
        parent_ad_id = COALESCE(excluded.parent_ad_id, ads_entity_state.parent_ad_id),
        external_creative_id = COALESCE(excluded.external_creative_id, ads_entity_state.external_creative_id),
        entity_name = COALESCE(excluded.entity_name, ads_entity_state.entity_name),
        status = COALESCE(excluded.status, ads_entity_state.status),
        objective = COALESCE(excluded.objective, ads_entity_state.objective),
        currency = COALESCE(excluded.currency, ads_entity_state.currency),
        timezone = COALESCE(excluded.timezone, ads_entity_state.timezone),
        source_updated_at = COALESCE(excluded.source_updated_at, ads_entity_state.source_updated_at),
        first_seen_at = MIN(ads_entity_state.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(ads_entity_state.last_seen_at, excluded.last_seen_at),
        source_availability_status = excluded.source_availability_status,
        metadata_hash = excluded.metadata_hash,
        last_coverage_run_id = excluded.last_coverage_run_id,
        last_sync_run_id = excluded.last_sync_run_id,
        updated_at = excluded.updated_at
      WHERE excluded.platform = ads_entity_state.platform
        AND excluded.account_key = ads_entity_state.account_key
        AND excluded.entity_type = ads_entity_state.entity_type
        AND excluded.external_entity_id = ads_entity_state.external_entity_id
        AND excluded.last_seen_at >= ads_entity_state.last_seen_at
    `, bindColumns(row, [
      'entity_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
      'entity_type', 'external_entity_id', 'parent_campaign_id', 'parent_ad_group_id',
      'parent_ad_id', 'external_creative_id', 'entity_name', 'status', 'objective', 'currency',
      'timezone', 'source_updated_at', 'first_seen_at', 'last_seen_at',
      'source_availability_status', 'metadata_hash', 'last_coverage_run_id',
      'last_sync_run_id', 'created_at', 'updated_at',
    ]));
  }

  async upsertAdsDailyFact(value) {
    const row = validateStorageRow('ads_daily_facts', value);
    const columns = [
      'ads_fact_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
      'report_level', 'entity_type', 'external_entity_id', 'external_campaign_id',
      'external_ad_group_id', 'external_ad_id', 'external_creative_id', 'metric_date',
      'account_timezone', 'breakdown_key', 'segment_key', 'ad_channel', 'currency',
      'spend_micros', 'impressions', 'reach', 'clicks', 'conversions',
      'conversion_value_micros', 'video_views', 'video_view_rate', 'average_cpv_micros',
      'actions_json', 'breakdown_json', 'data_status', 'coverage_run_id', 'source_revision',
      'source_payload_hash', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
    ];
    return this.#genericUpsert({
      table: 'ads_daily_facts', keyField: 'ads_fact_key', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['source_payload_hash', 'source_revision', 'data_status'],
    });
  }

  async upsertAdsConversionDailyFact(value) {
    const row = validateStorageRow('ads_conversion_daily_facts', value);
    const columns = [
      'conversion_fact_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
      'report_level', 'external_entity_id', 'external_campaign_id', 'external_ad_group_id',
      'external_ad_id', 'metric_date', 'account_timezone', 'conversion_action_key',
      'conversion_action_name', 'conversion_category', 'segment_key', 'currency',
      'conversions', 'all_conversions', 'conversion_value_micros',
      'all_conversion_value_micros', 'data_status', 'coverage_run_id', 'source_revision',
      'source_payload_hash', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
    ];
    return this.#genericUpsert({
      table: 'ads_conversion_daily_facts', keyField: 'conversion_fact_key', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['source_payload_hash', 'source_revision', 'data_status'],
    });
  }

  async saveCoverageRun(value) {
    const row = validateStorageRow('data_coverage_runs', value);
    const columns = [
      'coverage_run_id', 'sync_run_id', 'customer_key', 'platform', 'account_key',
      'dataset_key', 'metric_semantics', 'scope_mode', 'period_start', 'period_end',
      'source_timezone', 'status', 'expected_entities', 'observed_entities',
      'expected_rows', 'observed_rows', 'written_rows', 'failed_rows', 'source_watermark',
      'revisable_until', 'started_at', 'completed_at', 'error_code', 'created_at', 'updated_at',
    ];
    return this.#genericUpsert({
      table: 'data_coverage_runs', keyField: 'coverage_run_id', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['status', 'source_watermark', 'observed_rows', 'written_rows', 'failed_rows'],
    });
  }

  async saveCoverageEntities(values) {
    if (!Array.isArray(values)) throw contractInputError('coverage entities must be an array');
    const results = [];
    for (const value of values) {
      const row = validateStorageRow('data_coverage_entities', value);
      const columns = [
        'coverage_entity_key', 'coverage_run_id', 'entity_type', 'external_entity_id',
        'observation_status', 'source_revision', 'observed_at', 'created_at',
      ];
      results.push(await this.#genericUpsert({
        table: 'data_coverage_entities', keyField: 'coverage_entity_key', row, columns,
        updateColumns: ['observation_status', 'source_revision', 'observed_at'],
        noOpHashFields: ['observation_status', 'source_revision', 'observed_at'],
      }));
    }
    return Object.freeze(results);
  }

  /**
   * Execute one bounded durable Meta write unit with D1 batch semantics. Statements are
   * ordered exactly like the application write set and the whole unit is committed before
   * the resumable-work checkpoint advances. Bindings without batch support retain the
   * existing sequential behavior for tests and non-Cloudflare adapters.
   */
  async writeMetaD1Operations(operations) {
    if (!Array.isArray(operations)
      || operations.length < 1
      || operations.length > MAX_META_D1_BATCH_ROWS) {
      throw contractInputError(
        `Meta D1 operations must contain 1 to ${MAX_META_D1_BATCH_ROWS} rows`,
      );
    }
    if (typeof this.db.batch !== 'function') {
      const results = [];
      for (const operation of operations) {
        results.push(await this.#writeMetaD1OperationSequential(operation));
      }
      return Object.freeze(results);
    }

    const prepared = operations.map((operation) => prepareMetaD1Operation(this.db, operation));
    let rawResults;
    try {
      rawResults = await this.db.batch(prepared.map((entry) => entry.statement));
    } catch (cause) {
      throw d1WriteError('meta_history_batch', cause);
    }
    if (!Array.isArray(rawResults) || rawResults.length !== prepared.length) {
      throw transientError('D1 Meta batch returned an unexpected result count', {
        code: 'D1_MARKETING_STORAGE_BATCH_RESULT_INVALID',
        details: {
          expectedResults: prepared.length,
          observedResults: Array.isArray(rawResults) ? rawResults.length : null,
        },
      });
    }
    return Object.freeze(prepared.map((entry, index) => {
      const changes = readChanges(rawResults[index]);
      return freezeWrite(
        changes > 0 ? 'written' : 'skipped',
        entry.table,
        entry.key,
        changes,
      );
    }));
  }

  async #writeMetaD1OperationSequential(operation) {
    if (operation?.kind === 'account_daily') {
      return this.upsertOrganicAccountDailyFact(operation.row);
    }
    if (operation?.kind === 'ads_entity') return this.upsertAdsEntityState(operation.row);
    if (operation?.kind === 'ads_daily') return this.upsertAdsDailyFact(operation.row);
    if (operation?.kind === 'coverage_run') return this.saveCoverageRun(operation.row);
    if (operation?.kind === 'coverage_entity') {
      const results = await this.saveCoverageEntities([operation.row]);
      return results[0];
    }
    throw contractInputError(`Unsupported Meta D1 operation kind: ${operation?.kind ?? ''}`);
  }

  async saveReportMaterialization(value) {
    const row = validateStorageRow('report_materializations', value);
    const columns = [
      'report_id', 'report_setting_key', 'customer_key', 'platform_scope', 'account_key',
      'report_type', 'period_kind', 'window_days', 'period_start', 'period_end',
      'compare_start', 'compare_end', 'data_status', 'coverage_rate', 'formula_version',
      'source_watermark', 'payload_json', 'payload_checksum', 'generated_at', 'expires_at',
      'created_at', 'updated_at',
    ];
    return this.#genericUpsert({
      table: 'report_materializations', keyField: 'report_id', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['payload_checksum', 'source_watermark', 'data_status'],
    });
  }

  async saveReportRequest(value) {
    const row = validateStorageRow('report_requests', value);
    const columns = [
      'request_id', 'customer_key', 'account_key', 'platform_scope', 'period_start',
      'period_end', 'comparison_mode', 'status', 'result_report_id', 'requested_at',
      'started_at', 'finished_at', 'error_code', 'created_at', 'updated_at',
    ];
    return this.#genericUpsert({
      table: 'report_requests', keyField: 'request_id', row, columns,
      updateColumns: ['status', 'result_report_id', 'started_at', 'finished_at', 'error_code', 'updated_at'],
      noOpHashFields: ['status', 'result_report_id', 'finished_at', 'error_code'],
    });
  }

  async listOrganicContentObservations(input = {}) {
    const contentKey = requireText(input.contentKey, 'contentKey');
    const fromObservedAt = optionalInteger(input.fromObservedAt, 'fromObservedAt');
    const toObservedAt = optionalInteger(input.toObservedAt, 'toObservedAt');
    const limit = boundedLimit(input.limit, MAX_OBSERVATION_QUERY_ROWS);
    const conditions = ['content_key = ?'];
    const bindings = [contentKey];
    if (fromObservedAt !== null) { conditions.push('observed_at >= ?'); bindings.push(fromObservedAt); }
    if (toObservedAt !== null) { conditions.push('observed_at <= ?'); bindings.push(toObservedAt); }
    bindings.push(limit);
    return this.#all(`
      SELECT * FROM organic_content_observations
      WHERE ${conditions.join(' AND ')}
      ORDER BY observed_at ASC, observation_key ASC
      LIMIT ?
    `, bindings, 'D1_ORGANIC_OBSERVATION_QUERY_FAILED');
  }

  async listAdsDailyFacts(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const platform = requireText(input.platform, 'platform');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) throw contractInputError('periodStart cannot be after periodEnd');
    const limit = boundedLimit(input.limit, MAX_FACT_QUERY_ROWS);
    return this.#all(`
      SELECT * FROM ads_daily_facts
      WHERE customer_key = ? AND platform = ? AND account_key = ?
        AND metric_date >= ? AND metric_date <= ?
      ORDER BY metric_date ASC, ads_fact_key ASC
      LIMIT ?
    `, [customerKey, platform, accountKey, periodStart, periodEnd, limit], 'D1_ADS_FACT_QUERY_FAILED');
  }

  async listAdsConversionDailyFacts(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const platform = requireText(input.platform, 'platform');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) throw contractInputError('periodStart cannot be after periodEnd');
    const limit = boundedLimit(input.limit, MAX_FACT_QUERY_ROWS);
    return this.#all(`
      SELECT * FROM ads_conversion_daily_facts
      WHERE customer_key = ? AND platform = ? AND account_key = ?
        AND metric_date >= ? AND metric_date <= ?
      ORDER BY metric_date ASC, conversion_fact_key ASC
      LIMIT ?
    `, [customerKey, platform, accountKey, periodStart, periodEnd, limit], 'D1_ADS_CONVERSION_QUERY_FAILED');
  }

  async listReportMaterializations(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const limit = boundedLimit(input.limit, MAX_REPORT_QUERY_ROWS);
    return this.#all(`
      SELECT * FROM report_materializations
      WHERE customer_key = ? AND account_key = ?
      ORDER BY generated_at DESC, report_id ASC
      LIMIT ?
    `, [customerKey, accountKey, limit], 'D1_REPORT_MATERIALIZATION_QUERY_FAILED');
  }

  async readReportRequest(requestId) {
    return this.#first(
      'SELECT * FROM report_requests WHERE request_id = ?',
      [requireText(requestId, 'requestId')],
      'D1_REPORT_REQUEST_READ_FAILED',
    );
  }

  async #genericUpsert(input) {
    const { table, keyField, row, columns, updateColumns, noOpHashFields } = input;
    const updateSql = updateColumns.map((field) => `${field} = excluded.${field}`).join(',\n        ');
    const noOpSql = noOpHashFields.length === 0
      ? '1 = 1'
      : noOpHashFields.map((field) => `${table}.${field} IS NOT excluded.${field}`).join(' OR ');
    return this.#runWrite(table, row[keyField], `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders(columns.length)})
      ON CONFLICT(${keyField}) DO UPDATE SET
        ${updateSql}
      WHERE ${noOpSql}
    `, bindColumns(row, columns));
  }

  async #runWrite(table, key, sql, bindings) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).run();
      const changes = readChanges(result);
      return freezeWrite(changes > 0 ? 'written' : 'skipped', table, key, changes);
    } catch (cause) {
      throw d1WriteError(table, cause);
    }
  }

  async #first(sql, bindings, code) {
    try {
      return await this.db.prepare(sql).bind(...bindings).first();
    } catch (cause) {
      throw d1ReadError(code, cause);
    }
  }

  async #all(sql, bindings, code) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).all();
      const rows = Array.isArray(result) ? result : (result?.results ?? []);
      return Object.freeze(rows.map((row) => Object.freeze({ ...row })));
    } catch (cause) {
      throw d1ReadError(code, cause);
    }
  }
}

function prepareMetaD1Operation(db, operation) {
  if (!operation || typeof operation !== 'object' || Array.isArray(operation)) {
    throw contractInputError('Meta D1 operation must be an object');
  }
  if (operation.kind === 'account_daily') {
    const row = validateStorageRow('organic_account_daily_facts', operation.row);
    const columns = [
      'account_daily_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
      'metric_date', 'account_timezone', 'followers', 'follows', 'profile_views', 'views',
      'reach', 'accounts_engaged', 'total_interactions', 'net_follows', 'data_status',
      'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
    ];
    return prepareGenericUpsert(db, {
      table: 'organic_account_daily_facts', keyField: 'account_daily_key', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['source_revision', 'data_status', 'fetched_at'],
    });
  }
  if (operation.kind === 'ads_entity') return prepareAdsEntityUpsert(db, operation.row);
  if (operation.kind === 'ads_daily') {
    const row = validateStorageRow('ads_daily_facts', operation.row);
    const columns = [
      'ads_fact_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
      'report_level', 'entity_type', 'external_entity_id', 'external_campaign_id',
      'external_ad_group_id', 'external_ad_id', 'external_creative_id', 'metric_date',
      'account_timezone', 'breakdown_key', 'segment_key', 'ad_channel', 'currency',
      'spend_micros', 'impressions', 'reach', 'clicks', 'conversions',
      'conversion_value_micros', 'video_views', 'video_view_rate', 'average_cpv_micros',
      'actions_json', 'breakdown_json', 'data_status', 'coverage_run_id', 'source_revision',
      'source_payload_hash', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
    ];
    return prepareGenericUpsert(db, {
      table: 'ads_daily_facts', keyField: 'ads_fact_key', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['source_payload_hash', 'source_revision', 'data_status'],
    });
  }
  if (operation.kind === 'coverage_run') {
    const row = validateStorageRow('data_coverage_runs', operation.row);
    const columns = [
      'coverage_run_id', 'sync_run_id', 'customer_key', 'platform', 'account_key',
      'dataset_key', 'metric_semantics', 'scope_mode', 'period_start', 'period_end',
      'source_timezone', 'status', 'expected_entities', 'observed_entities',
      'expected_rows', 'observed_rows', 'written_rows', 'failed_rows', 'source_watermark',
      'revisable_until', 'started_at', 'completed_at', 'error_code', 'created_at', 'updated_at',
    ];
    return prepareGenericUpsert(db, {
      table: 'data_coverage_runs', keyField: 'coverage_run_id', row, columns,
      updateColumns: columns.slice(1).filter((field) => field !== 'created_at'),
      noOpHashFields: ['status', 'source_watermark', 'observed_rows', 'written_rows', 'failed_rows'],
    });
  }
  if (operation.kind === 'coverage_entity') {
    const row = validateStorageRow('data_coverage_entities', operation.row);
    const columns = [
      'coverage_entity_key', 'coverage_run_id', 'entity_type', 'external_entity_id',
      'observation_status', 'source_revision', 'observed_at', 'created_at',
    ];
    return prepareGenericUpsert(db, {
      table: 'data_coverage_entities', keyField: 'coverage_entity_key', row, columns,
      updateColumns: ['observation_status', 'source_revision', 'observed_at'],
      noOpHashFields: ['observation_status', 'source_revision', 'observed_at'],
    });
  }
  throw contractInputError(`Unsupported Meta D1 operation kind: ${operation.kind ?? ''}`);
}

function prepareAdsEntityUpsert(db, value) {
  const row = validateStorageRow('ads_entity_state', value);
  const columns = [
    'entity_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
    'entity_type', 'external_entity_id', 'parent_campaign_id', 'parent_ad_group_id',
    'parent_ad_id', 'external_creative_id', 'entity_name', 'status', 'objective', 'currency',
    'timezone', 'source_updated_at', 'first_seen_at', 'last_seen_at',
    'source_availability_status', 'metadata_hash', 'last_coverage_run_id',
    'last_sync_run_id', 'created_at', 'updated_at',
  ];
  const sql = `
      INSERT INTO ads_entity_state (
        ${columns.join(', ')}
      ) VALUES (${placeholders(columns.length)})
      ON CONFLICT(entity_key) DO UPDATE SET
        customer_key = excluded.customer_key,
        source_account_id = excluded.source_account_id,
        parent_campaign_id = COALESCE(excluded.parent_campaign_id, ads_entity_state.parent_campaign_id),
        parent_ad_group_id = COALESCE(excluded.parent_ad_group_id, ads_entity_state.parent_ad_group_id),
        parent_ad_id = COALESCE(excluded.parent_ad_id, ads_entity_state.parent_ad_id),
        external_creative_id = COALESCE(excluded.external_creative_id, ads_entity_state.external_creative_id),
        entity_name = COALESCE(excluded.entity_name, ads_entity_state.entity_name),
        status = COALESCE(excluded.status, ads_entity_state.status),
        objective = COALESCE(excluded.objective, ads_entity_state.objective),
        currency = COALESCE(excluded.currency, ads_entity_state.currency),
        timezone = COALESCE(excluded.timezone, ads_entity_state.timezone),
        source_updated_at = COALESCE(excluded.source_updated_at, ads_entity_state.source_updated_at),
        first_seen_at = MIN(ads_entity_state.first_seen_at, excluded.first_seen_at),
        last_seen_at = MAX(ads_entity_state.last_seen_at, excluded.last_seen_at),
        source_availability_status = excluded.source_availability_status,
        metadata_hash = excluded.metadata_hash,
        last_coverage_run_id = excluded.last_coverage_run_id,
        last_sync_run_id = excluded.last_sync_run_id,
        updated_at = excluded.updated_at
      WHERE excluded.platform = ads_entity_state.platform
        AND excluded.account_key = ads_entity_state.account_key
        AND excluded.entity_type = ads_entity_state.entity_type
        AND excluded.external_entity_id = ads_entity_state.external_entity_id
        AND excluded.last_seen_at >= ads_entity_state.last_seen_at
    `;
  return Object.freeze({
    table: 'ads_entity_state',
    key: row.entity_key,
    statement: db.prepare(sql).bind(...bindColumns(row, columns)),
  });
}

function prepareGenericUpsert(db, input) {
  const { table, keyField, row, columns, updateColumns, noOpHashFields } = input;
  const updateSql = updateColumns.map((field) => `${field} = excluded.${field}`).join(',\n        ');
  const noOpSql = noOpHashFields.length === 0
    ? '1 = 1'
    : noOpHashFields.map((field) => `${table}.${field} IS NOT excluded.${field}`).join(' OR ');
  const sql = `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders(columns.length)})
      ON CONFLICT(${keyField}) DO UPDATE SET
        ${updateSql}
      WHERE ${noOpSql}
    `;
  return Object.freeze({
    table,
    key: row[keyField],
    statement: db.prepare(sql).bind(...bindColumns(row, columns)),
  });
}

function assertObservationRetryMatches(existing, incoming) {
  const fields = [
    'observation_key', 'content_key', 'customer_key', 'platform', 'account_key',
    'external_content_id', 'observed_at', 'metric_date', 'source_timezone',
    'observation_kind', 'metric_semantics', 'views', 'likes', 'comments', 'shares',
    'unique_viewers', 'avg_watch_time_seconds', 'total_watch_time_seconds',
    'completion_rate', 'metrics_hash', 'source_revision', 'coverage_run_id',
    'fetched_at', 'sync_run_id',
  ];
  const mismatch = fields.find((field) => normalizeSqlValue(existing[field]) !== normalizeSqlValue(incoming[field]));
  if (mismatch) {
    throw permanentError('Observation Stable key was reused with a different durable payload', {
      code: 'D1_ORGANIC_OBSERVATION_IDENTITY_CONFLICT',
      details: { observationKey: incoming.observation_key, fieldName: mismatch },
    });
  }
}

function normalizeSqlValue(value) {
  return value === undefined ? null : value;
}

function bindColumns(row, columns) {
  return columns.map((field) => row[field] ?? null);
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function readChanges(result) {
  const value = result?.meta?.changes ?? result?.changes ?? 0;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function freezeWrite(status, table, key, changes) {
  return Object.freeze({ status, table, key, changes });
}

function boundedLimit(value, maximum) {
  const number = value === undefined || value === null ? maximum : value;
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw contractInputError(`limit must be an integer between 1 and ${maximum}`);
  }
  return number;
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value)) throw contractInputError(`${fieldName} must be a safe integer`);
  return value;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw contractInputError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw contractInputError(`${fieldName} is required`);
  return value.trim();
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1MarketingHistoryStore requires a D1 binding');
  return value;
}

function contractInputError(message) {
  return permanentError(message, { code: 'MKT_STORAGE_QUERY_INVALID' });
}

function d1WriteError(table, cause) {
  if (cause?.code === 'MKT_STORAGE_CONTRACT_INVALID'
    || cause?.code === 'D1_ORGANIC_OBSERVATION_IDENTITY_CONFLICT') return cause;
  return transientError(`Failed to write ${table}`, {
    code: 'D1_MARKETING_STORAGE_WRITE_FAILED',
    cause,
    details: { table, causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}

function d1ReadError(code, cause) {
  return transientError('Failed to read Marketing storage', {
    code,
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}

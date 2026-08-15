export const D1_CAPACITY_AUDIT_VERSION = 'd1-capacity-audit-v1';

export const D1_CAPACITY_TABLES = Object.freeze([
  'ads_conversion_daily_facts', 'ads_daily_facts', 'ads_entity_state',
  'chatwoot_account_daily_facts', 'chatwoot_account_state', 'chatwoot_agent_daily_facts',
  'chatwoot_agent_state', 'chatwoot_contact_state', 'chatwoot_conversation_daily_facts',
  'chatwoot_conversation_label_state', 'chatwoot_conversation_state', 'chatwoot_inbox_daily_facts',
  'chatwoot_inbox_state', 'chatwoot_label_state', 'chatwoot_message_analytics_state',
  'chatwoot_reporting_event_facts', 'chatwoot_team_state', 'commerce_customer_aggregates',
  'commerce_daily_sales_facts', 'commerce_order_line_facts', 'commerce_order_state',
  'commerce_order_status_observations', 'commerce_product_daily_facts', 'commerce_product_state',
  'commerce_store_state', 'connection_identity_selections', 'connection_invitations', 'connections',
  'daily_snapshots', 'data_coverage_entities', 'data_coverage_runs', 'dead_letter_jobs',
  'dead_letter_operation_metadata', 'encrypted_credentials', 'google_ads_delivery_chunks',
  'google_ads_delivery_nonces', 'google_ads_delivery_runs', 'google_ads_live_admissions',
  'google_ads_signing_provisioning_tickets', 'lark_notification_deliveries', 'oauth_state_attempts',
  'organic_account_daily_facts', 'organic_content_observations', 'organic_content_state',
  'queue_operation_attempts', 'raw_commerce_categories', 'raw_commerce_coupons',
  'raw_commerce_customers', 'raw_commerce_order_items', 'raw_commerce_orders',
  'raw_commerce_product_variations', 'raw_commerce_products', 'raw_commerce_refunds',
  'raw_commerce_stores', 'reliability_mirror_outbox', 'report_materializations', 'report_requests',
  'source_record_states', 'sync_cursors', 'sync_generation_fences', 'sync_jobs', 'sync_locks',
  'sync_runs', 'sync_warning_outbox', 'sync_work_phases', 'sync_work_runs', 'sync_work_units',
  'system_alerts', 'tiktok_source_admissions', 'youtube_analytics_daily_facts',
]);

export const D1_CAPACITY_GROWTH_TABLES = Object.freeze([
  'organic_content_observations', 'organic_account_daily_facts', 'ads_daily_facts',
  'ads_conversion_daily_facts', 'youtube_analytics_daily_facts',
  'chatwoot_conversation_daily_facts', 'chatwoot_agent_daily_facts',
  'chatwoot_inbox_daily_facts', 'chatwoot_account_daily_facts',
  'chatwoot_reporting_event_facts', 'commerce_daily_sales_facts',
  'commerce_product_daily_facts', 'report_materializations', 'lark_notification_deliveries',
]);

export function buildD1TableCountSql(tables = D1_CAPACITY_TABLES) {
  return tables.map((table) => {
    const name = safeIdentifier(table);
    return `SELECT '${name}' AS table_name, COUNT(*) AS row_count FROM ${name};`;
  }).join(' ');
}

export function buildD1GrowthSql(now = Date.now(), tables = D1_CAPACITY_GROWTH_TABLES) {
  const timestamp = positiveInteger(now, 'now');
  const cutoff = timestamp - (14 * 86_400_000);
  return tables.map((table) => {
    const name = safeIdentifier(table);
    return `SELECT '${name}' AS table_name, COUNT(*) AS row_count, SUM(CASE WHEN created_at>=${cutoff} THEN 1 ELSE 0 END) AS recent_14d_rows, MIN(created_at) AS first_created_at, MAX(created_at) AS last_created_at FROM ${name};`;
  }).join(' ');
}

export function buildD1WritesByPlatformSql(now = Date.now()) {
  const cutoff = positiveInteger(now, 'now') - (14 * 86_400_000);
  return `SELECT platform, COUNT(*) AS run_count, SUM(COALESCE(records_written,0)) AS records_written_14d FROM sync_runs WHERE started_at>=${cutoff} GROUP BY platform ORDER BY platform;`;
}

export function projectD1Growth(rows = [], horizons = [90, 365, 1095]) {
  return Object.freeze(rows.map((row) => {
    const rowCount = nonNegative(row.row_count, 'row_count');
    const recent = nonNegative(row.recent_14d_rows, 'recent_14d_rows');
    const dailyRate = recent / 14;
    return Object.freeze({
      tableName: safeIdentifier(row.table_name),
      rowCount,
      recent14dRows: recent,
      observedDailyRate: round(dailyRate),
      projectedRows: Object.freeze(Object.fromEntries(horizons.map((days) => [
        `${positiveInteger(days, 'horizon')}d`,
        Math.ceil(rowCount + (dailyRate * days)),
      ]))),
    });
  }));
}

export function summarizeD1Capacity(input = {}) {
  const counts = Array.isArray(input.counts) ? input.counts : [];
  const totalRows = counts.reduce((sum, row) => sum + nonNegative(row.row_count, 'row_count'), 0);
  const databaseBytes = nonNegative(input.databaseBytes, 'databaseBytes');
  const projections = projectD1Growth(input.growth ?? []);
  const currentProjectedRows = projections.reduce((sum, row) => sum + row.rowCount, 0);
  return Object.freeze({
    contractVersion: D1_CAPACITY_AUDIT_VERSION,
    databaseBytes,
    databaseMiB: round(databaseBytes / (1024 * 1024)),
    tableCount: counts.length,
    indexCount: nonNegative(input.indexCount, 'indexCount'),
    totalRows,
    growthTableRows: currentProjectedRows,
    projections,
    writesByPlatform: Object.freeze((input.writesByPlatform ?? []).map((row) => Object.freeze({
      platform: String(row.platform ?? 'unknown'),
      runCount: nonNegative(row.run_count, 'run_count'),
      recordsWritten14d: nonNegative(row.records_written_14d, 'records_written_14d'),
    }))),
    counts: Object.freeze(counts.map((row) => Object.freeze({
      tableName: safeIdentifier(row.table_name),
      rowCount: nonNegative(row.row_count, 'row_count'),
    }))),
  });
}

function safeIdentifier(value) {
  const text = String(value ?? '');
  if (!/^[a-z][a-z0-9_]*$/u.test(text)) throw new TypeError('table_name must be a safe identifier');
  return text;
}

function nonNegative(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

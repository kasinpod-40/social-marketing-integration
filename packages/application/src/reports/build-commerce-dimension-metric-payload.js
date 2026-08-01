const COLLECTION_CONTRACTS = Object.freeze([
  Object.freeze({
    collectionKey: 'top_products',
    dimensionType: 'product',
    limit: 5,
    valueField: 'net_sales_micros',
    identityField: 'product_key',
    labelField: null,
    metricKey: 'woocommerce:dimension:product:net_sales_micros',
    displayPrefix: 'Top product',
    unit: 'currency',
  }),
  Object.freeze({
    collectionKey: 'payment_methods',
    dimensionType: 'payment_method',
    limit: 20,
    valueField: 'recognized_revenue_micros',
    identityField: 'payment_method_id',
    labelField: 'payment_method_title',
    metricKey: 'woocommerce:dimension:payment_method:recognized_revenue_micros',
    displayPrefix: 'Payment method',
    unit: 'currency',
  }),
  Object.freeze({
    collectionKey: 'shipping_methods',
    dimensionType: 'shipping_method',
    limit: 20,
    valueField: 'recognized_revenue_micros',
    identityField: 'shipping_method_id',
    labelField: 'shipping_method_title',
    metricKey: 'woocommerce:dimension:shipping_method:recognized_revenue_micros',
    displayPrefix: 'Shipping method',
    unit: 'currency',
  }),
]);

/**
 * Normalize bounded WooCommerce collections into generic fixed-rank Report Metric payload rows.
 *
 * Fixed rank identities are required because TableSyncEngine is upsert-only. Empty ranks are
 * emitted as non-visible null placeholders so a later rerun clears stale values instead of
 * leaving a former Product/Payment/Shipping rank visible in Lark.
 */
export function buildCommerceDimensionMetricPayload(input = {}) {
  const platform = requireText(input.platform ?? 'woocommerce', 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const collections = requireObject(input.collections ?? {}, 'collections');
  const output = [];
  let sortOrder = 1;

  for (const contract of COLLECTION_CONTRACTS) {
    const rows = normalizeRows(collections[contract.collectionKey], contract.collectionKey);
    for (let index = 0; index < contract.limit; index += 1) {
      const rank = index + 1;
      const source = rows[index] ?? null;
      const sourceIdentity = source
        ? requireText(source[contract.identityField], `${contract.collectionKey}.${contract.identityField}`)
        : null;
      const sourceLabel = source
        ? optionalText(contract.labelField ? source[contract.labelField] : null) ?? sourceIdentity
        : null;
      const current = source ? optionalFinite(source[contract.valueField]) : null;
      const dimensionValue = `rank:${rank}`;
      output.push(Object.freeze({
        metricKey: `${platform}:dimension:${contract.dimensionType}:${contract.valueField}`,
        displayName: sourceLabel
          ? `${contract.displayPrefix} #${rank} · ${sourceLabel}`
          : `${contract.displayPrefix} #${rank} · ไม่มีข้อมูล`,
        unit: contract.unit,
        current,
        compare: null,
        change: null,
        changePercent: null,
        clientVisible: source !== null,
        sortOrder,
        formulaVersion,
        metricScope: 'period_delta',
        availabilityStatus: current === null ? 'not_observed' : 'available',
        dimensionType: contract.dimensionType,
        dimensionValue,
        rank,
        sourceDimensionValue: sourceIdentity,
        sourceDimensionLabel: sourceLabel,
      }));
      sortOrder += 1;
    }
  }

  return Object.freeze(output);
}

function normalizeRows(value, fieldName) {
  if (value === null || value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`Commerce dimension collection ${fieldName} must be an array`);
  return Object.freeze(value.map((row) => requireObject(row, `${fieldName} row`)));
}

function optionalFinite(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError('Commerce dimension metric must be finite');
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}

/** Validate และลดรูป WooCommerce Order payload ให้เหลือเฉพาะ Field ที่ใช้วาง Data Model */
export function mapWooCommerceOrderContract(order, input = {}) {
  requireObject(order, 'WooCommerce order');
  const storeKey = requireIdentityText(input.storeKey, 'storeKey');
  const orderId = readSafeId(order.id, 'order.id');
  const lineItems = requireArray(order.line_items ?? [], 'order.line_items').map((item) => Object.freeze({
    lineItemId: readSafeId(item?.id, 'line_item.id'),
    productId: readSafeId(item?.product_id, 'line_item.product_id'),
    variationId: readNullableSafeId(item?.variation_id, 'line_item.variation_id'),
    quantity: readNonNegativeInteger(item?.quantity, 'line_item.quantity'),
    total: readMoneyText(item?.total, 'line_item.total'),
  }));

  return Object.freeze({
    source: 'woocommerce_rest_v3',
    storeKey,
    externalOrderId: orderId,
    orderKey: `woocommerce:${storeKey}:${orderId}`,
    status: requireText(order.status, 'order.status'),
    currency: requireCurrency(order.currency),
    total: readMoneyText(order.total, 'order.total'),
    dateCreatedGmt: requireDateTimeText(order.date_created_gmt, 'order.date_created_gmt'),
    dateModifiedGmt: requireDateTimeText(order.date_modified_gmt, 'order.date_modified_gmt'),
    lineItems: Object.freeze(lineItems),
  });
}

function readSafeId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return String(number);
}

function readNullableSafeId(value, fieldName) {
  if (value === null || value === undefined || value === '' || Number(value) === 0) return null;
  return readSafeId(value, fieldName);
}

function readNonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
  return number;
}

function readMoneyText(value, fieldName) {
  if (typeof value !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(value.trim())) {
    throw new TypeError(`${fieldName} must be a decimal string`);
  }
  return value.trim();
}

function requireCurrency(value) {
  const text = requireText(value, 'order.currency').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(text)) throw new TypeError('order.currency must be a 3-letter code');
  return text;
}

function requireDateTimeText(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(text)) {
    throw new TypeError(`${fieldName} must be WooCommerce GMT date-time text`);
  }
  return `${text}Z`;
}

function requireIdentityText(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`WooCommerce contract requires ${fieldName}`);
  return value.trim();
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

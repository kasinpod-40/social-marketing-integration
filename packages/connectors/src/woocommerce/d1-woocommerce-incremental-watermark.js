import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

/**
 * อ่าน Watermark ที่ปลอดภัยร่วมกันของ Orders และ Products.
 * ใช้ค่าที่เก่ากว่าเพื่อยอม Over-fetch แต่ไม่ข้ามการแก้ไขของ Dataset ใด Dataset หนึ่ง.
 */
export async function readWooCommerceIncrementalWatermark(input = {}) {
  const db = requireD1(input.db);
  const accountKey = requireText(input.accountKey, 'accountKey');
  try {
    const row = await db.prepare(`
      SELECT
        (SELECT MAX(source_modified_at) FROM commerce_order_state WHERE account_key = ?) AS order_watermark,
        (SELECT MAX(source_modified_at) FROM commerce_product_state WHERE account_key = ?) AS product_watermark
    `).bind(accountKey, accountKey).first();
    const orderWatermark = nullableTimestamp(row?.order_watermark);
    const productWatermark = nullableTimestamp(row?.product_watermark);
    if (orderWatermark === null || productWatermark === null) return null;
    return Math.min(orderWatermark, productWatermark);
  } catch (cause) {
    throw transientError('WooCommerce incremental watermark read failed', {
      code: 'WOOCOMMERCE_INCREMENTAL_WATERMARK_READ_FAILED',
      cause,
    });
  }
}

function requireD1(value) {
  if (!value || typeof value.prepare !== 'function') {
    throw permanentError('WooCommerce D1 binding is unavailable for scheduled watermark read', {
      code: 'WOOCOMMERCE_D1_BINDING_MISSING',
    });
  }
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`WooCommerce ${fieldName} is required`, { code: 'WOOCOMMERCE_INCREMENTAL_WATERMARK_INVALID' });
  }
  return value.trim();
}
function nullableTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

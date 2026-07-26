import test from 'node:test';
import assert from 'node:assert/strict';
import { generateWooCommerceCommerceReport } from '../../packages/application/src/commerce/generate-woocommerce-commerce-report.js';

test('shipping summaries count one Order once when multiple methods are attached', async () => {
  const source = {
    async loadRange() {
      return {
        accountKey: 'chemistry_k',
        currency: 'THB',
        periodStart: '2026-07-26',
        periodEnd: '2026-07-26',
        daily: [{
          gross_sales_micros: 100_000_000,
          discount_micros: 0,
          refund_micros: 0,
          net_sales_micros: 100_000_000,
          shipping_micros: 10_000_000,
          tax_micros: 7_000_000,
          recognized_revenue_micros: 117_000_000,
          recognized_orders: 1,
          provisional_orders: 0,
          cancelled_orders: 0,
          failed_orders: 0,
          refunded_orders: 0,
          quantity_total: 1,
          data_status: 'complete',
          source_revision: '1',
        }],
        products: [],
        orders: [{
          status_class: 'recognized',
          payment_method_id: 'bacs',
          payment_method_title: 'Bank transfer',
          shipping_method_ids_json: JSON.stringify(['flat_rate', 'local_pickup']),
          shipping_method_titles_json: JSON.stringify(['Flat rate', 'Local pickup']),
          recognized_revenue_micros: 117_000_000,
          refund_micros: 0,
        }],
      };
    },
  };

  const report = await generateWooCommerceCommerceReport({
    source,
    accountKey: 'chemistry_k',
    periodStart: '2026-07-26',
    periodEnd: '2026-07-26',
    currency: 'THB',
  });

  assert.equal(report.shipping_methods.length, 1);
  assert.equal(report.shipping_methods[0].shipping_method_id, 'flat_rate+local_pickup');
  assert.equal(report.shipping_methods[0].recognized_orders, 1);
  assert.equal(report.shipping_methods[0].recognized_revenue_micros, 117_000_000);
  assert.equal(report.payment_methods[0].recognized_orders, 1);
});

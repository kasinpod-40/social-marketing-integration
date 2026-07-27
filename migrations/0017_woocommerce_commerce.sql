-- WooCommerce Commerce additive Migration 0017.
-- Allocated by Integration wiring; source-only until a separate Remote apply authorization.
-- Additive tables/indexes only; no existing Business fact is modified by this file.

CREATE TABLE IF NOT EXISTS raw_commerce_stores (
  store_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  base_url_hash TEXT NOT NULL,
  wc_version TEXT,
  wp_version TEXT,
  timezone TEXT NOT NULL,
  currency TEXT,
  number_of_decimals INTEGER,
  source_payload_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS raw_commerce_orders (
  raw_order_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  order_number TEXT,
  status TEXT NOT NULL,
  currency TEXT NOT NULL,
  source_created_at INTEGER NOT NULL,
  source_modified_at INTEGER NOT NULL,
  customer_type TEXT NOT NULL,
  external_customer_id TEXT,
  payment_method_id TEXT,
  payment_method_title TEXT,
  shipping_method_ids_json TEXT NOT NULL,
  shipping_method_titles_json TEXT NOT NULL,
  gross_sales_micros INTEGER NOT NULL,
  discount_micros INTEGER NOT NULL,
  shipping_micros INTEGER NOT NULL,
  tax_micros INTEGER NOT NULL,
  refund_micros INTEGER NOT NULL,
  total_micros INTEGER NOT NULL,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_commerce_orders_modified
  ON raw_commerce_orders(account_key, source_modified_at, external_order_id);
CREATE INDEX IF NOT EXISTS idx_raw_commerce_orders_status
  ON raw_commerce_orders(account_key, status, source_created_at);

CREATE TABLE IF NOT EXISTS raw_commerce_order_items (
  raw_order_item_key TEXT PRIMARY KEY,
  raw_order_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  external_line_item_id TEXT NOT NULL,
  external_product_id TEXT,
  external_variation_id TEXT,
  sku TEXT,
  product_name TEXT,
  quantity INTEGER NOT NULL,
  subtotal_micros INTEGER NOT NULL,
  subtotal_tax_micros INTEGER NOT NULL,
  total_micros INTEGER NOT NULL,
  total_tax_micros INTEGER NOT NULL,
  taxes_json TEXT NOT NULL,
  source_payload_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(raw_order_key, external_line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_commerce_order_items_product
  ON raw_commerce_order_items(account_key, external_product_id, external_variation_id);

CREATE TABLE IF NOT EXISTS raw_commerce_products (
  raw_product_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_product_id TEXT NOT NULL,
  product_type TEXT,
  sku TEXT,
  product_name TEXT,
  status TEXT,
  catalog_visibility TEXT,
  currency TEXT,
  price_micros INTEGER,
  regular_price_micros INTEGER,
  sale_price_micros INTEGER,
  stock_status TEXT,
  stock_quantity INTEGER,
  manage_stock INTEGER,
  category_ids_json TEXT NOT NULL,
  source_created_at INTEGER,
  source_modified_at INTEGER,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_product_id)
);
CREATE INDEX IF NOT EXISTS idx_raw_commerce_products_modified
  ON raw_commerce_products(account_key, source_modified_at, external_product_id);

CREATE TABLE IF NOT EXISTS raw_commerce_product_variations (
  raw_variation_key TEXT PRIMARY KEY,
  raw_product_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_product_id TEXT NOT NULL,
  external_variation_id TEXT NOT NULL,
  sku TEXT,
  status TEXT,
  currency TEXT,
  price_micros INTEGER,
  regular_price_micros INTEGER,
  sale_price_micros INTEGER,
  stock_status TEXT,
  stock_quantity INTEGER,
  manage_stock INTEGER,
  attributes_json TEXT NOT NULL,
  source_created_at INTEGER,
  source_modified_at INTEGER,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_product_id, external_variation_id)
);

CREATE TABLE IF NOT EXISTS raw_commerce_categories (
  raw_category_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_category_id TEXT NOT NULL,
  external_parent_id TEXT,
  category_name TEXT,
  slug TEXT,
  display TEXT,
  menu_order INTEGER,
  product_count INTEGER,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_category_id)
);

CREATE TABLE IF NOT EXISTS raw_commerce_customers (
  raw_customer_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  customer_type TEXT NOT NULL,
  orders_count INTEGER,
  total_spent_micros INTEGER,
  currency TEXT,
  source_created_at INTEGER,
  source_modified_at INTEGER,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_customer_id)
);

CREATE TABLE IF NOT EXISTS raw_commerce_coupons (
  raw_coupon_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_coupon_id TEXT NOT NULL,
  coupon_code_hash TEXT NOT NULL,
  discount_type TEXT,
  amount_micros INTEGER,
  currency TEXT,
  usage_count INTEGER,
  individual_use INTEGER,
  free_shipping INTEGER,
  date_expires_at INTEGER,
  source_created_at INTEGER,
  source_modified_at INTEGER,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_coupon_id)
);

CREATE TABLE IF NOT EXISTS raw_commerce_refunds (
  raw_refund_key TEXT PRIMARY KEY,
  raw_order_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  external_refund_id TEXT NOT NULL,
  refund_micros INTEGER NOT NULL,
  currency TEXT NOT NULL,
  reason_present INTEGER NOT NULL,
  refunded_by_user_id TEXT,
  source_created_at INTEGER,
  line_items_json TEXT NOT NULL,
  source_payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(raw_order_key, external_refund_id)
);

CREATE TABLE IF NOT EXISTS commerce_store_state (
  store_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  wc_version TEXT,
  wp_version TEXT,
  reporting_timezone TEXT NOT NULL,
  default_currency TEXT,
  number_of_decimals INTEGER,
  last_observed_at INTEGER NOT NULL,
  source_payload_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key)
);

CREATE TABLE IF NOT EXISTS commerce_order_state (
  order_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  order_number TEXT,
  status TEXT NOT NULL,
  status_class TEXT NOT NULL,
  currency TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  source_created_at INTEGER NOT NULL,
  source_modified_at INTEGER NOT NULL,
  customer_type TEXT NOT NULL,
  external_customer_id TEXT,
  payment_method_id TEXT,
  payment_method_title TEXT,
  shipping_method_ids_json TEXT NOT NULL,
  shipping_method_titles_json TEXT NOT NULL,
  gross_sales_micros INTEGER NOT NULL,
  discount_micros INTEGER NOT NULL,
  refund_micros INTEGER NOT NULL,
  net_sales_micros INTEGER NOT NULL,
  shipping_micros INTEGER NOT NULL,
  tax_micros INTEGER NOT NULL,
  order_total_micros INTEGER NOT NULL,
  recognized_revenue_micros INTEGER NOT NULL,
  recognized_order_count INTEGER NOT NULL,
  provisional_order_count INTEGER NOT NULL,
  line_item_count INTEGER NOT NULL,
  quantity_total INTEGER NOT NULL,
  source_payload_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, external_order_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_state_date
  ON commerce_order_state(customer_key, account_key, metric_date, currency);
CREATE INDEX IF NOT EXISTS idx_commerce_order_state_modified
  ON commerce_order_state(account_key, source_modified_at, external_order_id);
CREATE INDEX IF NOT EXISTS idx_commerce_order_state_customer
  ON commerce_order_state(account_key, external_customer_id, currency, source_created_at);

CREATE TABLE IF NOT EXISTS commerce_order_status_observations (
  status_observation_key TEXT PRIMARY KEY,
  order_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  status TEXT NOT NULL,
  status_class TEXT NOT NULL,
  source_modified_at INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  coverage_run_id TEXT NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(order_key, status, source_modified_at)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_status_history
  ON commerce_order_status_observations(order_key, source_modified_at DESC);

CREATE TABLE IF NOT EXISTS commerce_order_line_facts (
  order_line_key TEXT PRIMARY KEY,
  order_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_order_id TEXT NOT NULL,
  external_line_item_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  external_product_id TEXT,
  external_variation_id TEXT,
  sku TEXT,
  product_name TEXT,
  metric_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  gross_sales_micros INTEGER NOT NULL,
  discount_micros INTEGER NOT NULL,
  net_sales_micros INTEGER NOT NULL,
  tax_micros INTEGER NOT NULL,
  refunded_quantity INTEGER NOT NULL,
  refund_micros INTEGER NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(order_key, external_line_item_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_order_line_product_date
  ON commerce_order_line_facts(account_key, product_key, metric_date, currency);

CREATE TABLE IF NOT EXISTS commerce_product_state (
  product_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_product_id TEXT NOT NULL,
  external_variation_id TEXT,
  parent_product_key TEXT,
  product_type TEXT,
  sku TEXT,
  product_name TEXT,
  status TEXT,
  catalog_visibility TEXT,
  currency TEXT,
  price_micros INTEGER,
  regular_price_micros INTEGER,
  sale_price_micros INTEGER,
  stock_status TEXT,
  stock_quantity INTEGER,
  manage_stock INTEGER,
  category_ids_json TEXT NOT NULL,
  attributes_json TEXT NOT NULL,
  source_created_at INTEGER,
  source_modified_at INTEGER,
  source_payload_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, external_product_id, external_variation_id)
);
CREATE INDEX IF NOT EXISTS idx_commerce_product_state_modified
  ON commerce_product_state(account_key, source_modified_at, product_key);
CREATE INDEX IF NOT EXISTS idx_commerce_product_state_sku
  ON commerce_product_state(account_key, sku);

CREATE TABLE IF NOT EXISTS commerce_customer_aggregates (
  customer_aggregate_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  external_customer_id TEXT NOT NULL,
  customer_type TEXT NOT NULL,
  orders_count INTEGER,
  total_spent_micros INTEGER,
  currency TEXT,
  first_order_at INTEGER,
  last_order_at INTEGER,
  source_created_at INTEGER,
  source_modified_at INTEGER,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, external_customer_id, currency)
);

CREATE TABLE IF NOT EXISTS commerce_daily_sales_facts (
  commerce_daily_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  gross_sales_micros INTEGER NOT NULL,
  discount_micros INTEGER NOT NULL,
  refund_micros INTEGER NOT NULL,
  net_sales_micros INTEGER NOT NULL,
  shipping_micros INTEGER NOT NULL,
  tax_micros INTEGER NOT NULL,
  recognized_revenue_micros INTEGER NOT NULL,
  recognized_orders INTEGER NOT NULL,
  provisional_orders INTEGER NOT NULL,
  cancelled_orders INTEGER NOT NULL,
  failed_orders INTEGER NOT NULL,
  refunded_orders INTEGER NOT NULL,
  quantity_total INTEGER NOT NULL,
  data_status TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, metric_date, currency)
);
CREATE INDEX IF NOT EXISTS idx_commerce_daily_sales_range
  ON commerce_daily_sales_facts(customer_key, account_key, metric_date, currency);

CREATE TABLE IF NOT EXISTS commerce_product_daily_facts (
  product_daily_key TEXT PRIMARY KEY,
  product_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  currency TEXT NOT NULL,
  quantity_ordered INTEGER NOT NULL,
  gross_sales_micros INTEGER NOT NULL,
  discount_micros INTEGER NOT NULL,
  refund_micros INTEGER NOT NULL,
  net_sales_micros INTEGER NOT NULL,
  recognized_orders INTEGER NOT NULL,
  data_status TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(product_key, metric_date, currency)
);
CREATE INDEX IF NOT EXISTS idx_commerce_product_daily_range
  ON commerce_product_daily_facts(customer_key, account_key, metric_date, currency, product_key);

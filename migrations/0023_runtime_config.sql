-- Customer-owned non-secret runtime configuration.
-- Secrets stay in Workers Secrets; resource bindings stay in Wrangler.
CREATE TABLE IF NOT EXISTS runtime_config (
  environment TEXT NOT NULL CHECK (environment IN ('development', 'production')),
  customer_key TEXT NOT NULL CHECK (length(customer_key) BETWEEN 1 AND 128),
  config_key TEXT NOT NULL CHECK (length(config_key) BETWEEN 1 AND 128),
  config_value TEXT NOT NULL CHECK (length(config_value) <= 8192),
  source TEXT NOT NULL DEFAULT 'customer_d1'
    CHECK (source IN ('customer_d1', 'wrangler_cutover', 'operator')),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (environment, customer_key, config_key)
);

CREATE INDEX IF NOT EXISTS idx_runtime_config_customer
ON runtime_config(environment, customer_key, updated_at DESC);

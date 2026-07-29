# WooCommerce Successful-HTTP Invalid-JSON Incident — 2026-07-29

## Durable evidence

```text
operation_id             woo-final-full-6f43ac8ee857
source                    chemistryk.online / wc/v3 / 45s / THB
Queue propagation delay  120 seconds
sync run                  failed / WOOCOMMERCE_INVALID_JSON
durable work              active, unlocked
phase                     datasetIndex 0 / page 1 / incomplete
Queue attempts            1
Coverage                   0
all Commerce rows          0
automatic safe restore     PASS
safe Worker version        40ea3319-1da5-4a90-91c1-44d2451f5efd
```

The failure is after receipt of a successful HTTP response at `system_status`, unlike the earlier
zero-millisecond Cloudflare `Illegal invocation` failure. No evidence currently identifies the body
shape because the merged client discarded it after `response.json()` failed.

## Repository response

Branch `hotfix/woocommerce-invalid-json-diagnostics` adds bounded non-secret response diagnostics,
BOM-safe JSON parsing and a single-GET local Provider diagnostic operator. It reuses the existing
WooCommerce REST client, Runtime config and read-only inspector. It does not create a second
Connector, Queue framework, recovery engine, D1 writer or Lark path.

## Operational order

```text
merge reviewed diagnostics hotfix
→ one local Provider GET-only probe
→ classify origin-wide vs Worker-path response difference
→ add exact recovery-only authority for 6f43ac8ee857 when appropriate
→ separately authorize any new Worker diagnostic or Final rollout
```

Automatic Queue resend remains forbidden. The current Worker is all-flags-false and schedules remain
disabled.

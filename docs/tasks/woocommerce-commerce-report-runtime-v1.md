# WooCommerce Platform-neutral Commerce Report Runtime v1

## Objective

Materialize verified WooCommerce D1 facts through the existing platform-neutral Report contracts
and write the resulting Report Snapshot/Metric rows to Integration Workspace Lark.

## Architecture

- Platform registry capability: `commerce`
- Platform scope: `woocommerce`
- Source: existing `D1WooCommerceReportSource`
- Calculation: existing `generateWooCommerceCommerceReport`
- Persistence: shared `report_materializations`
- Lark: shared `writeDashboardMaterializationToLark`
- Dashboard discovery: existing universal materialization model

No WooCommerce-specific Dashboard renderer, Queue framework, D1 writer or Lark engine is added.

## Materialization

The shared payload contains:

- deterministic current/compare Commerce metrics;
- currency context;
- top five Products;
- up to twenty Payment methods;
- up to twenty Shipping methods.

All collections remain inside the existing validated and checksummed materialization contract.
Lark receives the shared Snapshot plus Metric rows. Commerce does not invent Organic Content or
Paid Ads ranking rows.

## Runtime gates

Commerce materialization requires:

- global D1 Report read enabled;
- WooCommerce Report read enabled;
- WooCommerce connector, D1 write, Lark ingestion and full reconciliation disabled;
- WooCommerce Schedule disabled;
- configured non-secret default currency.

AI summary, Daily Report schedule and Weekly Report schedule remain disabled.

## Guarded Live closeout

หลัง WooCommerce Final ingestion และ same-operation replay ผ่าน ให้รัน one-command operator
บน clean current `main`:

```bash
CONFIRM_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT=EXECUTE_WOOCOMMERCE_REPORT_RUNTIME_CLOSEOUT \
node scripts/woocommerce-report-runtime-closeout.mjs --execute
```

Wrapper ใช้ Report Schema/Settings finalizer เดิมก่อน แล้วจึง reuse Report closeout operator
เดิมใน explicit `woocommerce` mode. Active window เปิดจริงเพียง:

```text
MKT_REPORT_D1_READ_ENABLED
MKT_REPORT_PRESET_MATERIALIZATION_ENABLED
MKT_WOOCOMMERCE_REPORT_READ_ENABLED
```

ทุก Connector, WooCommerce ingestion/D1-write/Lark-ingestion/full/schedule, AI และ Report
schedule flags เป็น false. Operator ตรวจ Commerce Coverage/facts, D1 backup, exact Worker
bindings, fresh deterministic Report ID, D1/Lark metric parity และ exact same-job replay ก่อน
คืน Worker เป็น all-false Safe state ใน `finally`. Evidence แยกอยู่ที่
`outputs/woocommerce-report-runtime-closeout/`.

## Verification

- Focused application tests: `32/32`
- Focused Workers runtime tests: `3/3`
- Full unit tests: `1476/1476`
- Full Workers runtime tests: `16/16`
- Report reliability tests: `101/101`
- Architecture/hygiene: `401` source modules, `0` cycles, no hygiene violation
- Dependency audit: `0` vulnerabilities
- Deploy dry-run: passed

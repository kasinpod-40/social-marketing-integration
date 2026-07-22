# 03 — Platform Decisions

## TikTok Organic

Use Lark TikTok For Creator Native Integration as the protected RAW source for the current MVP. The Worker reads the native-managed table and writes Canonical Content/Daily through the shared sync/reliability path.

Missing metrics remain `null`; unique viewers must not be renamed to Reach without a source contract.

## TikTok Ads

Production direction is a controlled TikTok Business/Reporting API connector through Worker, Queue, D1 and the Canonical Ads model.

Lark TikTok For Business Native Integration may be used only for temporary discovery or developer-owned comparison when explicitly approved. It is not the Production source of truth and must not bypass connector reliability, idempotency, audit or customer-owned Production requirements.

Required before implementation:

- Business Center/advertiser authorization and exact identity preflight
- scopes/token lifecycle and app review requirements
- Sandbox/test strategy
- reporting dimensions/metrics and null semantics
- pagination/rate-limit contract
- stable keys and reconciliation
- Queue/DLQ/D1 reliability
- customer-real UAT and Production ownership

## Google Ads

MVP extraction uses a customer-authorized Google Ads Manager Script with exact account allowlisting and read-only `AdsApp.search()` GAQL.

Direct Google Ads API remains an optional Phase 2 path for scale, centralized OAuth or fields unavailable to Scripts.

Current direct API state:

```text
Basic Access application submitted 2026-07-21
Case ID 1-686800040839
Review pending
Current access Test Account Access
```

External Script delivery requires a separately approved signed endpoint and remains disabled until payload version, HMAC, timestamp, nonce, replay, idempotency, retention, redaction, Queue/D1 and destination-write contracts pass.

## Meta / Facebook / Instagram Organic

Use controlled Meta Graph business adapters through the shared Worker/Queue/D1 reliability architecture. Transport is shared; Page and Instagram Business identity/metric mappings stay separate.

## Meta Ads

Use Marketing API with customer-authorized `ads_read`, exact Ad Account identity, bounded pagination and Canonical Ads normalization. Valid no-data preflight is not a connector completion signal.

## YouTube Organic

Use YouTube Data API for Channel/Video inventory and YouTube Analytics API for Owner period metrics. Public and Owner identities must match before writes.

## WooCommerce

Use customer-owned REST credentials with bounded pagination. Monetary source values remain decimal strings at the connector boundary. Avoid customer PII in the active marketing-data scope.

## Chatwoot

Use customer-owned API access and retain only approved operational conversation/inbox/agent/status timestamps. Message bodies, email and phone are excluded unless a later approved scope explicitly requires them.

## Cross-platform permanent rule

Every custom connector must use:

- central Connector and Job catalogs
- stable keys and idempotency
- bounded pagination/chunking
- Queue/DLQ and D1 checkpoint/lock state
- partial-write and retry classification
- reconciliation and retention
- secret/identity redaction
- shared-DEV logical profile safety and Production isolation
- schedule disabled by default

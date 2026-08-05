# Report Readiness Bootstrap Binding Incident — 2026-08-05

The Report Runtime Finalizer succeeded on exact main `eac8c494a253ba2f8b21791813f51014e9e3d1ee` with zero schema or
Settings drift, four active Executive Settings preserved, Notification Worker baseline preserved and Notification
Admission false.

SELECT-only readiness for Facebook, Instagram, YouTube, Meta Ads, Google Ads, TikTok Ads, WooCommerce and Chatwoot
then stopped before Source/D1/Lark readiness assessment because the existing Notification Runtime Worker did not
contain `LARK_TABLE_MKT_REPORT_TOP_ADS`.

This is not channel unready evidence. Every channel remained unevaluated. The run performed zero Provider request,
Queue action, Remote mutation or Worker deployment.

The existing Worker predates first Report activation. Report-only bindings are bootstrap-optional before that first
bounded deployment, but any optional binding already present must match the Finalizer mapping. Once an Active or
restored Worker version is deployed, all Report and Notification bindings are mandatory and exact.

Authoritative contract:

```text
docs/tasks/report-readiness-bootstrap-bindings-v1.md
```

No manual `wrangler.sync.jsonc`, `.dev.vars`, Worker, Lark, D1 or Queue change is authorized by this incident.

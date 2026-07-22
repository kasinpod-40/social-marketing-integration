# Customer-real UAT Contract — Superseded

## Status

This document is retained only as historical context.

The previous model separated developer data, customer-real UAT and Production into three operating environments/profiles. The user has explicitly replaced that model for the current project workflow.

## Current authoritative model

Use:

- `docs/current-task.md`
- `docs/project-brain/integration-workspace.md`
- `AGENTS.md`

The current rule is:

```text
One pre-Production Integration Workspace
MKT_ENV=development
MKT_CUSTOMER_PROFILE=integration_workspace
```

The existing developer-owned Lark/Cloudflare resources are used to assemble the complete system. Source ownership is tracked per Connector and can be mixed temporarily. Do not create or switch to a separate UAT Worker, D1, Queue, DLQ, Lark Base or Profile merely because a channel uses customer data.

Production is still separate and must be customer-owned.

## TikTok correction

TikTok Organic is already connected through Lark Native to Chemistry K `@chemistry_k`. The Base RAW table is populated. The current gap is the unverified Chemistry K RAW → `MKT_Content` / `MKT_Content_Daily` Canonical synchronization, not customer authorization and not an account switch.

Historical profile/configuration names do not authorize record deletion or relabeling.

## Historical boundary

Sections from older revisions that require isolated DEV/UAT infrastructure, `uat_chemistry_k`, or a new TikTok customer connection are no longer operational instructions and must not be used for new work.

# 02 — Architecture

## Style
Clean Architecture + Monorepo + Modular Monolith.

## Package direction
- `apps/api-worker`: health checks, connection endpoints, OAuth callbacks, admin endpoints.
- `apps/sync-worker`: cron, sync orchestration, queue producers/consumers.
- `apps/lark-worker`: Lark write queue, batch upsert, schema preflight.
- `packages/domain`: pure business rules and metric definitions.
- `packages/application`: use cases and ports.
- `packages/connectors`: platform and Lark adapters.
- `packages/infrastructure`: Cloudflare D1, Queues, secrets, observability.
- `packages/contracts`: normalized data schemas.
- `packages/config`: platform capabilities, metric dictionary, field mapping.
- `packages/shared`: small reusable utilities.

## Dependency rule
Domain must not import infrastructure, connectors, Cloudflare, Lark, Meta, TikTok, or Google SDKs.

## Data flow
```
Platform / Native Raw Table
    -> Connector Adapter
    -> Normalized Model
    -> Application Use Case
    -> D1 / Queue
    -> Lark Writer
    -> Snapshot / Dashboard / AI Summary
```

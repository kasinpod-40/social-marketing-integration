# Social Marketing Data Integration

A Cloudflare + Lark Base data integration project for social organic and ads reporting.

## Stack
- JavaScript ES Modules
- Cloudflare Workers
- Cloudflare D1
- Cloudflare Queues
- Lark Base / Lark OpenAPI / Lark Native Integrations

## Architecture
Clean Architecture + Monorepo + Modular Monolith.

```
apps -> application -> domain
connectors/infrastructure implement application ports
```

## Phase 0 start command
This skeleton has no external dependencies for the included baseline tests.

```bash
npm test
```

## Definition of Done
Code is not complete unless tests/regression pass and the Project Brain is updated.

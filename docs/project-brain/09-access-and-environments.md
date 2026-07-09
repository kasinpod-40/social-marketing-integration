# 09 — Access and Environments

## Default ownership model
The client should own production resources whenever business verification or official production assets are required.

## Freelancer constraint
The developer is a freelancer without a registered company. Use client-owned production apps/resources by default, or use provider-owned native integrations when possible.

## Required resource types
- Cloudflare account / Workers / D1 / Queues / Secrets
- Lark tenant / Lark Base / Lark Custom App if needed
- Meta developer/business assets
- TikTok Business Center / Developer App if custom API is needed
- Google Cloud / Google Ads access
- YouTube channel permissions and OAuth consent

## Security
- No password sharing.
- Use roles, IAM, partners, collaborators, and OAuth.
- Tokens must be encrypted and never stored in Lark.

## v0.1.4 environment model
- One client should deploy one Cloudflare project/Worker with its own env vars.
- Source code must stay client-neutral and must not hardcode real Lark table IDs.
- Table IDs are configured through `.dev.vars` locally and Cloudflare Variables/Secrets in production.
- `LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY` is required for dictionary-based classification.

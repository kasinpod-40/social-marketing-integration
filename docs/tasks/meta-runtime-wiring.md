# Meta Runtime Wiring — Chemistry K Multi-Account Integration Task

## Status

`IMPLEMENTED_DRAFT / READ_ONLY_CUSTOMER_VALIDATION_PENDING`

## Authority and baseline

- Repository: `kasinpod-40/social-marketing-integration`
- Parent Meta implementation PR `#69`: merged at `11e861cfbc79ea067a90496b205f692ca8bb4d3d`
- Runtime Draft PR: `#73`, branch `agent/meta-runtime-wiring`
- Latest main reviewed before this hotfix: `8b7f9a879ba0c1b0b5d89dcfa2373ad3bb3c2ce8`
- Latest migration reviewed: `0016_tiktok_post_lark_pipeline.sql`
- New migration: none

This branch owns Meta runtime wiring only. It does not replace the parallel TikTok operator task recorded in `docs/current-task.md` on main.

## Chemistry K exact customer mappings

The user supplied redacted Graph discovery results that identify these customer assets:

```text
Facebook Page
key=chemistry_k
page_id=982406442148381
name=เคมี K

Instagram Professional Account
key=chemistry_k
account_id=17841413521012797
username=chemistry_key

Meta Ads
sourceAccountKey=chemistry_k2
account_id=505898710119851
name=ChemistryK2
status=active
currency=THB
timezone=Asia/Bangkok

sourceAccountKey=chemistry_k3
account_id=851206695716861
name=ChemistryK3
status=active
currency=THB
timezone=Asia/Bangkok
```

These are non-secret mappings. Token validity and runtime source reads are still pending a separately approved read-only validation.

## Multi-account contract

`META_AD_ACCOUNT_MAPPINGS` uses comma-separated `key=account_id` entries:

```text
META_AD_ACCOUNT_MAPPINGS=chemistry_k2=505898710119851,chemistry_k3=851206695716861
```

Each Meta Ads Queue job must select exactly one alias:

```text
sourceAccountKey=chemistry_k2
# or
sourceAccountKey=chemistry_k3
```

The stable Queue identity is account-scoped:

```text
meta_ads:<sourceAccountKey>:<operationId>
```

Sync run IDs and Reliability lock types are also account-scoped by the non-sensitive alias. Continuations preserve the alias. Runtime rejects aliases not present in the configured mapping.

Coverage run IDs include the exact source account ID so two accounts cannot collide even if an operator accidentally reuses an operation ID. D1 and Canonical stable rows continue using the existing approved Meta Ads contracts and `source_account_id` fields.

## Runtime gates

All gates remain false by default:

```text
MKT_CONNECTOR_FACEBOOK_ENABLED=false
MKT_CONNECTOR_INSTAGRAM_ENABLED=false
MKT_CONNECTOR_META_ADS_ENABLED=false
MKT_META_SOURCE_READ_ENABLED=false
MKT_META_D1_WRITE_ENABLED=false
MKT_META_LARK_WRITE_ENABLED=false
MKT_META_REPORT_READ_ENABLED=false
```

No account mapping enables a connector, Queue producer, write path or schedule.

## Controlled rollout order

```text
one read-only Facebook validation
→ one read-only Instagram validation
→ Meta Ads chemistry_k2 read-only validation
→ Meta Ads chemistry_k3 read-only validation
→ review sanitized evidence
→ separate D1-only approval per account
→ Coverage reconciliation per account
→ separate Lark parity approval
→ separate LIVE UAT and activation decision
```

## Explicitly not performed

- no Meta token read, rotation or disclosure;
- no Provider request from this implementation task;
- no Worker deployment;
- no Remote D1 migration or business mutation;
- no Remote Lark schema or record mutation;
- no Queue message;
- no Cron/Schedule activation;
- no Production secret or Cloudflare configuration change;
- no Customer LIVE UAT;
- no merge of PR `#73`.

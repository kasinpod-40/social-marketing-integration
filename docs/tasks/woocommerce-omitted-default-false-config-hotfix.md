# WooCommerce Omitted Default-false Config Hotfix

## Incident

The final one-command rollout reached `lark-schema-additive-repair` and stopped before safe deployment because the canonical ignored `wrangler.sync.jsonc` omitted `MKT_WOOCOMMERCE_D1_WRITE_ENABLED`. Runtime treats an omitted WooCommerce execution gate as `false`, but the rollout config builder required every field to already exist before replacing it.

## Correction

- Parse the canonical Wrangler config as JSONC using the existing shared parser.
- Clone the complete config and preserve all existing non-secret values and infrastructure bindings.
- Materialize all six WooCommerce execution gates as string `false` in the generated safe config, whether present or omitted in the canonical config.
- Materialize all 14 WooCommerce Lark table mappings from additive schema repair results.
- Derive UAT and scheduled windows from the generated safe config and retain exact true-flag validation.
- Do not modify the ignored canonical Wrangler config.

## Safety and retry semantics

- No Repository implementation step performs Remote D1, Lark, Queue, Worker, Schedule, Provider, or Production action.
- The failed live attempt had `automaticSafeRestore=null`, proving no safe/active deployment window had been established by the child operator.
- Lark schema repair is additive and idempotent; existing tables and fields are reused on retry.
- Migration `0017` remains ledger-checked and is not reapplied when already present.
- The final REST Queue wrapper remains the only executable entrypoint.

## Acceptance

- A JSONC config with omitted WooCommerce gates and omitted WooCommerce Lark mappings generates valid safe/UAT/scheduled configs.
- Safe config has zero true execution flags.
- UAT and scheduled true-flag sets remain exact.
- Unrelated non-secret vars are preserved.
- Existing full Repository verification passes.

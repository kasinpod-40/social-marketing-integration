# Customer-owned D1 Runtime Config Cutover

## Goal

Move reviewed non-secret runtime configuration out of Cloudflare Worker text bindings and into the
existing customer-owned D1 database. Secrets remain Worker Secrets. D1 / Queue bindings remain Wrangler
resource bindings.

The first approved scope is deliberately narrow and high-value. Release example files intentionally keep the historical Lark mappings as review/test fixtures; the controlled cutover removes them only from the real ignored `wrangler.sync.jsonc`:

- every `LARK_TABLE_*` ID;
- `TIKTOK_ADS_APP_ID`.

This frees dozens of text bindings without changing business data, schedules, Queue payloads, Lark rows,
or TikTok Organic behavior.

## Runtime

Every Sync Worker fetch, scheduled event and Queue batch hydrates the allowlisted D1 values before the
existing handlers run. Existing config loaders continue reading `env.KEY`, so connectors do not need
parallel configuration systems.

Bootstrap bindings intentionally remain in Wrangler:

- `MKT_ENV`;
- `MKT_CUSTOMER_PROFILE`;
- `MKT_CONNECTION_CUSTOMER_KEY`;
- `MKT_CONNECTION_PUBLIC_ORIGIN`;
- Cloudflare D1 / Queue resource bindings;
- all Secrets.

## Controlled cutover

Preview is mutation-free:

```bash
npm run cutover:d1-runtime-config -- \
  --config=wrangler.sync.jsonc \
  --tiktok-app-id=<NON_SECRET_APP_ID>
```

Execute performs only:

1. apply additive D1 migrations;
2. upsert allowlisted non-secret rows into `runtime_config`;
3. create a mode-0600 Wrangler backup;
4. remove only migrated scalar keys from the local ignored Wrangler config.

It does **not** upload or deploy a Worker version and does not change Production traffic.

```bash
npm run cutover:d1-runtime-config:apply -- \
  --config=wrangler.sync.jsonc \
  --tiktok-app-id=<NON_SECRET_APP_ID>
```

After the cutover, upload a new version, provision `TIKTOK_ADS_APP_SECRET` as a normal Worker Secret,
verify, and only then deploy traffic.

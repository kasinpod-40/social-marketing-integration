# WooCommerce D1 Bound-parameter Hotfix v1

## Live incident

Final operation `woo-final-full-e2372e56d52d` admitted exactly once and completed Store plus
the first Orders page. The second Orders page retained partial D1/Lark facts and failed through
the existing retry path with:

```text
error_code      WOOCOMMERCE_D1_READ_FAILED
error table     commerce_customer_aggregates
page size       100
account bind    1
value binds     100
total binds     101
```

The first Orders page had 99 distinct registered-customer aggregate keys and passed at exactly
100 total bindings. The full page had 100 distinct keys and failed at 101. Cloudflare D1 documents
a maximum of 100 bound parameters per query.

## Correction

- Keep the existing allowlisted table/field validation and prepared statements.
- Reserve one bound parameter for `account_key`.
- Chunk value lists to at most 99 values per query.
- Preserve the sorted, deduplicated value order across chunks.
- Reuse the same read path for daily sales, product daily and customer aggregate rows.
- Do not change D1 writes, Lark writes, Provider pagination, Queue identity or durable checkpoints.

## Continuation boundary

The exact operation already has partial Business/Coverage writes. It must not be abandoned or
replaced. After this hotfix is merged and Worker propagation is verified, resume/redrive only
`woo-final-full-e2372e56d52d` through the existing durable Queue retry/continuation contract.

## Safety

Repository implementation performs no Worker deployment, Queue send, D1/Lark mutation,
Schedule/Secret change or Production action.

## Verification

- Focused WooCommerce tests: `12/12`
- Unit tests: `1466/1466`
- Workers runtime tests: `15/15`
- Report reliability tests: `101/101`
- Architecture/hygiene: `399` source modules, `1027` dependencies, `0` cycles
- `npm audit`: `0` vulnerabilities
- Deploy dry-run: passed

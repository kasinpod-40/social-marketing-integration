# WooCommerce Exact Durable Continuation v1

## Objective

Resume only `woo-final-full-e2372e56d52d` after the D1 bound-parameter hotfix without abandoning
its partial D1/Lark facts and without admitting a replacement full operation.

## Contract

The operator accepts `MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID` and performs a read-only
preflight before any Lark or Worker mutation. It requires:

- failed sync with `WOOCOMMERCE_D1_READ_FAILED`;
- active, incomplete durable work and no active lock;
- at least one durable main Queue attempt;
- non-empty partial Business facts;
- identical work generation, work requested-at, Queue generation and Queue original requested-at.

The original requested-at is read from durable D1 evidence. The resumed Queue payload therefore
reuses the exact operation ID, work key, generation and original requested-at. No replacement
full operation is created.

## Remaining rollout

After exact continuation completes, the existing final operator must verify:

1. six complete/no-data Coverage datasets;
2. D1/Lark parity across all 14 Commerce mappings;
3. same-operation replay with unchanged Business and Coverage counts;
4. one bounded incremental Manual UAT operation;
5. final all-false Safe Worker deployment with Schedule/Cron disabled.

Production remains forbidden.

## Verification

- Focused exact-continuation and WooCommerce D1 tests: `17/17`
- Unit tests: `1467/1467`
- Workers runtime tests: `15/15`
- Report reliability tests: `101/101`
- Architecture/hygiene: `0` cycles and no repository hygiene violations
- Dependency audit: `0` vulnerabilities
- Deploy dry-run: passed

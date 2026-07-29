# WooCommerce Final Recovery-only Operator

## Live evidence — 2026-07-29

Exact read-only inspection of operation `woo-final-full-e486b03cfe8d` on merged
`main@294e48807963478c75381db66969f3efbdd8a8e6` proved:

```text
sync run              failed / WOOCOMMERCE_NETWORK_ERROR
network cause         Cloudflare Illegal invocation / incorrect this receiver
work lifecycle        active / stale
active locks          0
Queue attempts        1
Coverage runs         0
phase complete        false
completion            null
all Commerce rows     0
```

The Worker fetch-receiver correction was Squash Merged through PR #223 at
`d63317d989f872ff6d5698ad11184683e799d2c8`. No deployment or new Queue admission has occurred
since that merge.

## Objective

Recover only the exact stale durable-work row so a later guarded rollout is not blocked. This
operator must stop after recovery and must not delegate to the final rollout chain.

## Exact authority

```text
operation_id  woo-final-full-e486b03cfe8d
work_key      woocommerce:woo-final-full-e486b03cfe8d
account_key   chemistry_k
profile       integration_workspace
environment   development
```

Execution requires the dedicated confirmation:

```text
CONFIRM_WOOCOMMERCE_RECOVERY_ONLY=RECOVER_WOO_FINAL_FULL_E486B03CFE8D_ONLY
```

The final-rollout confirmation does not authorize this operator and the recovery-only
confirmation does not authorize deployment or Queue admission.

## Preflight

Before mutation, one bounded read-only snapshot must prove all conditions:

- Sync Run is terminal `failed`, finished and has an error code;
- durable work remains `active` and is not completed;
- completion is absent and the Commerce phase is incomplete;
- active lock count is zero;
- exactly one Queue operation attempt exists;
- Coverage and invalid Coverage counts are zero;
- all 14 WooCommerce D1 Business table counts for `chemistry_k` are zero.

Any mismatch fails closed without mutation.

## Mutation

Reuse the merged failed-work recovery contract. Execute once, without automatic retry, against
only the exact work key:

```text
sync_work_runs.lifecycle_status = terminal
terminal_reason                 = woocommerce_final_failed_sync_recovery
abandoned_at                    = set once
expires_at                      = seven-day retention, set once
audit_reference                 = repository-head-bound, set once
updated_at                      = current time
```

The SQL repeats the existing active/failed/no-live-lock guards and must report exactly one
recovered row.

## Post-verification

A second bounded read-only snapshot must prove:

- Sync Run remains failed;
- durable work is terminal;
- no active lock exists;
- Queue attempts remain exactly one;
- Coverage remains zero;
- phase/completion facts remain unchanged;
- all Commerce Business rows remain zero.

## Safety boundary

```text
Remote D1 lifecycle mutation   exactly one guarded sync_work_runs row
Business-table mutation        none
sync phase/unit deletion       none
generation-fence mutation      none
Queue/DLQ message              none
Worker deployment              none
Lark request or mutation       none
Provider request               none
Schedule/Secret/Production     none
```

## Post-merge command

Run only from clean merged `main`:

```bash
env \
  MKT_ENV=development \
  MKT_CUSTOMER_PROFILE=integration_workspace \
  MKT_CONNECTION_CUSTOMER_KEY=chemistry_k \
  CONFIRM_WOOCOMMERCE_RECOVERY_ONLY=RECOVER_WOO_FINAL_FULL_E486B03CFE8D_ONLY \
  node scripts/woocommerce-final-recovery-only.mjs \
    --operation-id woo-final-full-e486b03cfe8d \
    --execute
```

After a successful recovery, run the existing read-only inspector. A new final rollout remains a
separate explicit authorization.

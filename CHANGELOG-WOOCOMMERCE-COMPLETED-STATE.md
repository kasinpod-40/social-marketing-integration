# WooCommerce Completed-State Changelog

## Unreleased — Incremental Admission Race Recovery v1

### Live incident

- The completed-state closeout submitted the exact persisted Incremental UAT operation.
- The first D1 poll ran before Queue admission metadata became visible and threw on missing
  `queueOriginalRequestedAt`.
- Automatic all-false Safe restore completed.
- The accepted Queue message was consumed after restore and failed at the disabled Connector gate.
- The exact message became one open Terminal DLQ with zero Sync, Work, Phase, Coverage, Lock, Provider
  request or Incremental Business write.

### Root correction

- Queue-not-visible, Queue-visible-before-Sync/Work, running Sync and active Work are now explicit bounded
  pending states.
- Completed-state timestamp and completion validation no longer run before durable admission.
- Permanent Sync failure and all existing completion identity/scope/Coverage checks remain fail-closed.

### Exact recovery

- Added a public exact-head launcher and plan-only guarded operator.
- Recovery is pinned to previous-head evidence, original operation/requested-at/watermark and exact job
  SHA-256.
- Requires the exact open `WOOCOMMERCE_CONNECTOR_INVALID` Terminal DLQ and zero admitted Reliability state.
- Creates a fresh D1 backup before temporary Woo UAT activation.
- Sends only the same Incremental job; accepted recovery evidence blocks blind resend.
- Requires attempt growth, successful Sync, completed Work, retired Phase, six valid Coverage rows and
  D1/Lark parity.
- Closes only the exact DLQ and recovery metadata rows after completion.
- Restores and verifies all Worker execution flags false.

### Safety

Repository implementation and CI perform no Provider request, Remote D1/Lark mutation, Queue/DLQ send,
Worker deployment, Schedule activation, Meta execution or Production action.

### Post-merge command

```bash
CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY=\
RECOVER_WOO_INCREMENTAL_ADMISSION_RACE_EXACT_OPERATION_ONLY \
node scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs --execute
```

Do not run the original completed-state launcher or manually redrive the DLQ before this recovery.

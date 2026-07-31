# WooCommerce Completed-State Changelog

## 2026-07-31 — Incremental Admission Race Recovery v1 completed

### Live incident

- The completed-state closeout submitted the exact persisted Incremental UAT operation.
- The first D1 poll ran before Queue admission metadata became visible and threw on missing
  `queueOriginalRequestedAt`.
- Automatic all-false Safe restore completed.
- The accepted Queue message was consumed after restore and failed at the disabled Connector gate.
- The exact message became one open Terminal DLQ with zero Sync, Work, Phase, Coverage, Lock, Provider
  request or Incremental Business write.

### Root correction

- Queue-not-visible, Queue-visible-before-Sync/Work, running Sync and active Work are explicit bounded
  pending states.
- Completed-state timestamp and completion validation no longer run before durable admission.
- Permanent Sync failure and all existing completion identity/scope/Coverage checks remain fail-closed.
- PR #315 was Squash Merged as `c750a1655a91b64c2aa069d020a7044fa5e27a3a`.
- Final exact-head Branch Verification #1350 passed.

### Controlled recovery result

The guarded recovery ran successfully from
`main@2f66b7b139c192ebb964e8e7f520a30940acee7b` and returned:

```text
Decision                            WOOCOMMERCE_2026_COMPLETED_SAFE
Closeout marker                     WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE
Recovery marker                     WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE
Same Incremental operation          recovered
Replacement Incremental operation   false
Queue attempts                      4
D1/Lark parity                      pass
Exact Terminal DLQ                  closed
Worker flags                        all false
Active Work / Lock / Queue op        0 / 0 / 0
Old pre-2026 rows                    0
Schedule / Meta / Production         disabled / 0 / blocked
```

### Recovery evidence

```text
Evidence Head                       2f66b7b139c192ebb964e8e7f520a30940acee7b
Source evidence Head                d3592b256d52bf72e4a3d9d33ab707cb5bca4961
Backup bytes                        46590401
Backup SHA-256                      1de97c8c1906bc6efc0877b1e49cad4ffe58fd098ee32d39743c23bd63ba934d
Full completion fingerprint         64705bde96a6c7aee9793c7a1b5fba65afbbe9f97986394bbaf8661fc54fa74f
Incremental completion fingerprint  0caf61eadfb4a016dcb151b6422391c465463c4e4fc0470d6fdc1130bb1b98d2
Final safe Worker version           7bd10941-a97a-4c5c-bc95-6f3424ee25aa
```

The backup and exact-head recovery artifacts remain private local evidence and are not committed.

### Safety and closeout

- No replacement Full or Incremental operation was created.
- No Business fact was directly mutated or deleted.
- The exact two DLQ recovery metadata rows closed only after durable completion and parity passed.
- Blind Queue resend remained blocked.
- Worker execution flags returned to all-false.
- WooCommerce Schedule remained disabled.
- Meta execution remained zero.
- Production remained blocked.

The completed-state closeout and admission-race recovery launchers must not be run again for this closed
incident. The next separately controlled workstream is `resume_pinned_meta_finalizer`.

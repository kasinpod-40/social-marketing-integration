# Project Brain — Chatwoot Initial Terminal Failure Recovery

The current Chatwoot Initial operation is the retained session under Repository Head
`65855ee5cfe0ee7caf0080c9b0a7c8bc7c91dd7f`. Local attempt markers are not admission authority; the recovery
selector requires exact Queue/Work/unit proof from D1 and rejects ambiguous latest candidates.

The confirmed failure was an operator polling bug: `running` was counted as a failed unit, causing premature Safe
restore. The subsequent exact Queue retry reached the all-false Worker, returned
`CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID`, and terminalized the same Work. D1 masters remain authoritative and are
not deleted or reset.

Recovery must reuse the same operation ID, Work key, Sync Run ID, original requested-at and generation. One
sequence-zero recovery continuation is allowed only after exact guarded lifecycle reactivation and an attempt
marker. It is not a new Initial admission. Existing Stable-key D1/Lark writers reconcile missing Lark masters,
then the unchanged Final UAT verifies Initial/Daily replay stability and parity across all 15 targets.

Current and retained old incidents close only after accepted current-UAT, Safe restore and parity evidence.
Schedule and Webhook remain disabled; Production remains blocked. See
`docs/tasks/chatwoot-initial-terminal-failure-recovery-v1.md`.

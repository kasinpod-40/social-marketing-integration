# Project Brain — Chatwoot Initial Terminal Failure Recovery

The current Chatwoot Initial operation is the retained session under Repository Head
`65855ee5cfe0ee7caf0080c9b0a7c8bc7c91dd7f`. Local attempt markers are not admission authority; the recovery
selector requires exact Queue/Work/unit proof from D1 and rejects ambiguous latest candidates.

The recovery has exposed a sequence of exact live-contract failures while preserving one durable Work identity:
fractional epoch seconds, an all-false Safe-restore race, an optional `waiting_since` sentinel, a historical label
reference missing from the current label master, descending Message page order, and the
`conversation_resolved` Reporting event name. Every terminal boundary is admitted by exact Work, Queue, unit,
phase, error, DLQ, Alert, lock and Business-count proof; no generic terminal state is recoverable.

The latest retained boundary is attempt 14 / unit 2. Conversation page 1 committed before that failure, so the
durable state is `stage=conversations`, `nextSequence=2`, `conversationPage=2` and
`conversationPagesProcessed=1`. Its materialized evidence is 17 Conversations, 22 Conversation-label links,
590 Message analytics rows and 122 conversation Reporting events. Recovery must preserve those Stable-key rows
and resume page 2 rather than replaying or replacing the Initial operation.

`conversation_resolved` is a supported raw lifecycle-evidence event from the live Reporting API. It is retained
in the Reporting-event fact table but deliberately contributes no first-response, resolution or reply duration;
those metrics continue to come only from `first_response`, `resolution` and `reply_time` respectively. Other
unknown event names remain Permanent failures.

Recovery must reuse the same operation ID, Work key, Sync Run ID, original requested-at and generation. One
sequence-zero recovery continuation is allowed only after exact guarded lifecycle reactivation and an attempt
marker. It is not a new Initial admission. Existing Stable-key D1/Lark writers reconcile missing Lark masters,
then the unchanged Final UAT verifies Initial/Daily replay stability and parity across all 15 targets.

Current and retained old incidents close only after accepted current-UAT, Safe restore and parity evidence.
Schedule and Webhook remain disabled; Production remains blocked. See
`docs/tasks/chatwoot-initial-terminal-failure-recovery-v1.md`.

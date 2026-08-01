# Project Brain — Chatwoot Initial Terminal Failure Recovery

The current Chatwoot Initial operation is the retained session under Repository Head
`65855ee5cfe0ee7caf0080c9b0a7c8bc7c91dd7f`. Local attempt markers are not admission authority; the recovery
selector requires exact Queue/Work/unit proof from D1 and rejects ambiguous latest candidates.

The recovery has exposed a sequence of exact live-contract failures while preserving one durable Work identity:
fractional epoch seconds, an all-false Safe-restore race, an optional `waiting_since` sentinel, a historical label
reference missing from the current label master, descending Message page order, and the
`conversation_resolved` Reporting event name. Every terminal boundary is admitted by exact Work, Queue, unit,
phase, error, DLQ, Alert, lock and Business-count proof; no generic terminal state is recoverable.

The latest retained boundary is attempt 16 / unit 2. Conversation page 1 committed before that failure, so the
durable state is `stage=conversations`, `nextSequence=2`, `conversationPage=2` and
`conversationPagesProcessed=1`. Its materialized evidence is 17 Conversations, 22 Conversation-label links,
590 Message analytics rows and 122 conversation Reporting events. Recovery must preserve those Stable-key rows
and resume page 2 rather than replaying or replacing the Initial operation.

Chatwoot's authoritative `ReportingEventListener` emits `first_response`, `reply_time`,
`conversation_resolved`, `conversation_opened`, `conversation_bot_handoff` and
`conversation_bot_resolved`; the connector also retains legacy `resolution`. Every event is preserved in the raw
Reporting-event fact table. `conversation_resolved` is the current time-to-resolve event and contributes resolution
duration/count alongside legacy `resolution`; opened and bot lifecycle events remain evidence-only so the duplicated
bot-resolved companion cannot double-count resolution. Other unknown event names remain Permanent failures.

Recovery must reuse the same operation ID, Work key, Sync Run ID, original requested-at and generation. One
sequence-zero recovery continuation is allowed only after exact guarded lifecycle reactivation and an attempt
marker. It is not a new Initial admission. Existing Stable-key D1/Lark writers reconcile missing Lark masters,
then the unchanged Final UAT verifies Initial/Daily replay stability and parity across all 15 targets.

Current and retained old incidents close only after accepted current-UAT, Safe restore and parity evidence.
Schedule and Webhook remain disabled; Production remains blocked. See
`docs/tasks/chatwoot-initial-terminal-failure-recovery-v1.md`.

After the attempt-16 correction, the same Work advanced to sequence 3 and Conversation page 3. The local
controller then stopped because it reused one Cloudflare OAuth bearer throughout a long polling window; the token
expired even though the remote Worker continued normally. Controller resume therefore uses the sole incomplete
prior evidence directory as authority, verifies attempts >= 17 with the unchanged DLQ 8 / Alert 14 incident set,
and performs no Initial Queue send. Wrangler commands retain refreshable OAuth, Queue REST bearer resolution is
just in time, deployment checks are periodic, and Safe restore ownership is installed before resumed preflight.
Because the retained old source-config incident is inspected while that exact Work is still running, its open-state
validator permits at most the same single live lock only when controller-resume evidence is present. The ordinary
source-config path remains zero-lock, and every later closure/final-state check still requires zero active locks.
